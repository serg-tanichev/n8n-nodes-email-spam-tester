import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	ACCOUNT,
	BASE,
	apiRequest,
	collect,
	done,
	fetchReport,
	searchMailboxes,
	simplify,
	slugOf,
	waitForReport,
} from './GenericFunctions';
import { fields, operations, resource } from './descriptions';

// Programmatic rather than declarative: creating an address with the folder
// check is two dependent calls, Report › Get waits for the checks and falls
// back to a mailbox's private report, and the lists page with cursors.

const HISTORY_PAGE = 100;

function mailboxIdOf(this: IExecuteFunctions, i: number): number {
	const value = this.getNodeParameter('mailboxId', i, '', { extractValue: true }) as string;
	const id = Number(String(value).trim());
	if (!Number.isInteger(id) || id <= 0) {
		throw new NodeOperationError(this.getNode(), `"${value}" is not a mailbox ID`, {
			description: "Pick the mailbox from the list, or enter the number from 'id'.",
			itemIndex: i,
		});
	}
	return id;
}

const INBOX = new Set(['inbox', 'primary', 'updates', 'social', 'forums']);

function folderSummary(run: IDataObject): IDataObject {
	const fleet = (run.fleet as IDataObject) ?? {};
	// A mailbox that was never handed out has no result; one that was keeps its
	// row even if the mailbox is unavailable now.
	const rows = [
		...((run.results as IDataObject[]) ?? []),
		...((fleet.results as IDataObject[]) ?? []).filter(
			(r) => r.available !== false || (r.placement && r.placement !== 'pending'),
		),
	];
	const results = rows.map((r) => {
		const where = String(r.placement ?? 'pending');
		return { provider: r.provider, folder: where === 'pending' ? 'waiting' : where };
	});
	const count = (test: (folder: string) => boolean) => results.filter((r) => test(r.folder)).length;
	const inbox = count((f) => INBOX.has(f));
	const promotions = count((f) => f === 'promotions');
	const spam = count((f) => f === 'spam');
	const notReceived = count((f) => f === 'not_observed' || f === 'missing');
	const waiting = count((f) => f === 'waiting');
	return {
		folderCheckId: run.slug,
		// The public mailboxes finish first; our own ones are watched a while longer.
		done: run.status !== 'waiting' && (!run.fleet || fleet.status === 'finished') && waiting === 0,
		inbox,
		promotions,
		spam,
		other: results.length - inbox - promotions - spam - notReceived - waiting,
		notReceived,
		waiting,
		results,
	};
}

export class EmailSpamTester implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Email Spam Tester',
		name: 'emailSpamTester',
		icon: { light: 'file:emailSpamTester.svg', dark: 'file:emailSpamTester.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Check an email before you send it: SPF, DKIM, DMARC, blocklists, content and the folder at email providers',
		defaults: { name: 'Email Spam Tester' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'emailSpamTesterApi', required: true }],
		properties: [resource, ...operations, ...fields],
	};

	methods = { listSearch: { searchMailboxes } };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		const push = (data: IDataObject | IDataObject[], i: number) => {
			for (const json of Array.isArray(data) ? data : [data]) out.push({ json, pairedItem: { item: i } });
		};

		for (let i = 0; i < items.length; i++) {
			try {
				const resourceName = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resourceName === 'testAddress' && operation === 'create') {
					const language = this.getNodeParameter('language', i, 'en') as string;
					const reserved = (
						await apiRequest.call(this, 'POST', '/api/v1/inbox', { account: ACCOUNT, lang: language })
					).body;
					const slug = String(reserved.slug);
					const result: IDataObject = {
						testId: slug,
						address: reserved.address,
						reportUrl: `${BASE}/t/${slug}`,
						expiresAt: reserved.expires_at,
						folderCheckId: null,
						marker: null,
						folderMailboxes: [],
						recipients: [reserved.address],
					};
					if (this.getNodeParameter('checkFolders', i, false) as boolean) {
						// The address is reserved and counted by now: a folder check that
						// cannot start leaves it usable rather than failing the item.
						const started = await apiRequest.call(
							this,
							'POST',
							'/api/v1/placement',
							{},
							{ public_results_accepted: true, score_slug: slug, account: ACCOUNT },
							[429, 503],
						);
						if (started.statusCode !== 200 && started.statusCode !== 201) {
							result.folderCheckNote =
								started.statusCode === 429
									? 'No folder check: the 3 a day of this key are used up. The test address works without it.'
									: 'No folder check: no test mailboxes are available right now. The test address works without it.';
							push(result, i);
							continue;
						}
						const run = started.body;
						const seeds = ((run.results as IDataObject[]) ?? []).map((r) => r.address);
						const fleet = (((run.fleet as IDataObject)?.results as IDataObject[]) ?? [])
							.filter((r) => r.available !== false)
							.map((r) => r.address);
						const mailboxes = [...seeds, ...fleet].filter(Boolean);
						Object.assign(result, {
							folderCheckId: run.slug,
							marker: run.marker,
							folderMailboxes: mailboxes,
							recipients: [reserved.address, ...mailboxes],
						});
					}
					push(result, i);
				} else if (resourceName === 'report' && operation === 'get') {
					const slug = slugOf.call(this, this.getNodeParameter('testId', i) as string, 'Test ID', i);
					const wait = this.getNodeParameter('wait', i, true) as boolean;
					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					const brief = this.getNodeParameter('simplify', i, true) as boolean;
					let state = 'ready';
					if (wait) {
						state = await waitForReport.call(
							this,
							slug,
							Number(options.waitSeconds ?? 300),
							Boolean(options.waitForPlan),
						);
					}
					const found =
						state === 'expired'
							? ({ status: 'expired' } as const)
							: await fetchReport.call(this, slug, state === 'letter');
					if ('status' in found) {
						push({ testId: slug, status: found.status }, i);
					} else {
						push(
							brief
								? simplify(found.report, found.isPrivate)
								: { ...found.report, private: found.isPrivate },
							i,
						);
					}
				} else if (resourceName === 'report' && operation === 'getAll') {
					const all = this.getNodeParameter('returnAll', i, false) as boolean;
					const limit = all ? 0 : (this.getNodeParameter('limit', i, 50) as number);
					const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
					const brief = this.getNodeParameter('simplify', i, true) as boolean;
					const tests = await collect.call(
						this,
						async (before) => {
							const qs: IDataObject = { account: ACCOUNT, limit: HISTORY_PAGE };
							if (before) qs.before = before;
							if (filters.domain) qs.domain = String(filters.domain).trim().toLowerCase();
							const list = ((await apiRequest.call(this, 'GET', '/api/v1/installations/tests', qs))
								.body.tests as IDataObject[]) ?? [];
							return {
								items: list,
								next: list.length === HISTORY_PAGE ? String(list[list.length - 1].slug) : undefined,
							};
						},
						limit,
					);
					push(
						tests.map((t) =>
							brief
								? {
										testId: t.slug,
										createdAt: t.created_at,
										domain: t.domain,
										status: t.analysis_status,
										score: t.score_ours ?? null,
										score10: t.score_compat ?? null,
										complete: t.complete ?? null,
										changes: ((t.changes as IDataObject[]) ?? []).map(
											(c) => `${c.title}: ${c.from} → ${c.to}`,
										),
										folderCheck: t.placement ?? null,
										reportUrl: `${BASE}/t/${t.slug}`,
									}
								: t,
						),
						i,
					);
				} else if (resourceName === 'folderCheck' && operation === 'get') {
					const id = slugOf.call(this, this.getNodeParameter('folderCheckId', i) as string, 'Folder Check ID', i);
					const run = (await apiRequest.call(this, 'GET', `/api/v1/placement/${encodeURIComponent(id)}`))
						.body;
					push(folderSummary(run), i);
				} else if (resourceName === 'mailbox' && operation === 'create') {
					const domain = (this.getNodeParameter('domain', i) as string).trim().toLowerCase();
					const m = (
						await apiRequest.call(this, 'POST', '/api/v1/installations/mailboxes', {}, {
							domain,
							account: ACCOUNT,
							lang: 'en',
						})
					).body;
					push(m, i);
				} else if (resourceName === 'mailbox' && operation === 'get') {
					const id = mailboxIdOf.call(this, i);
					push(
						(await apiRequest.call(this, 'GET', `/api/v1/installations/mailboxes/${id}`, { account: ACCOUNT }))
							.body,
						i,
					);
				} else if (resourceName === 'mailbox' && operation === 'close') {
					const id = mailboxIdOf.call(this, i);
					push(
						(
							await apiRequest.call(this, 'DELETE', `/api/v1/installations/mailboxes/${id}`, {
								account: ACCOUNT,
							})
						).body,
						i,
					);
				} else if (resourceName === 'mailbox' && operation === 'getAll') {
					const all = this.getNodeParameter('returnAll', i, false) as boolean;
					const limit = all ? 0 : (this.getNodeParameter('limit', i, 50) as number);
					const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
					const boxes = await collect.call(
						this,
						async (after) => {
							const qs: IDataObject = { account: ACCOUNT, limit: 500, after_id: after ?? 0 };
							if (filters.state) qs.state = filters.state;
							const body = (await apiRequest.call(this, 'GET', '/api/v1/installations/mailboxes', qs)).body;
							return {
								items: (body.mailboxes as IDataObject[]) ?? [],
								next: (body.next_after_id as number) ?? undefined,
							};
						},
						limit,
					);
					push(boxes, i);
				} else if (resourceName === 'mailbox' && operation === 'getEmails') {
					const id = mailboxIdOf.call(this, i);
					const all = this.getNodeParameter('returnAll', i, false) as boolean;
					const limit = all ? 0 : (this.getNodeParameter('limit', i, 50) as number);
					const options = this.getNodeParameter('emailOptions', i, {}) as IDataObject;
					const path = `/api/v1/installations/mailboxes/${id}/letters`;
					const unsettled = Boolean(options.includeUnsettled);
					let letters: IDataObject[];
					if (options.oldestFirst || all) {
						// Oldest first pages by cursor, so it can reach every email.
						letters = await collect.call(
							this,
							async (after) => {
								const body = (
									await apiRequest.call(this, 'GET', path, {
										account: ACCOUNT,
										after_id: after ?? 0,
										limit: 500,
										settled: !unsettled,
									})
								).body;
								return {
									items: (body.letters as IDataObject[]) ?? [],
									next: (body.next_after_id as number) ?? undefined,
								};
							},
							limit,
						);
						if (!options.oldestFirst) letters.reverse();
					} else {
						// Newest first is one page at the API: enough for a limit.
						const body = (
							await apiRequest.call(this, 'GET', path, {
								account: ACCOUNT,
								newest: true,
								limit: Math.min(500, limit + 50),
							})
						).body;
						letters = ((body.letters as IDataObject[]) ?? [])
							.filter((l) => unsettled || done(l))
							.slice(0, limit);
					}
					push(
						letters.map((l) => ({ testId: l.slug, ...l })),
						i,
					);
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`"${operation}" is not an operation of "${resourceName}"`,
						{ itemIndex: i },
					);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				if (error instanceof NodeApiError) {
					// Already explained by apiRequest; hands back the same error.
					error.context.itemIndex = i;
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}
		return [out];
	}
}
