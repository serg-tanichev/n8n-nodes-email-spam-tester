import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	ACCOUNT,
	apiRequest,
	fetchReport,
	searchMailboxes,
	settled,
	simplify,
} from '../EmailSpamTester/GenericFunctions';
import { mailboxLocator } from '../EmailSpamTester/descriptions';

// Reports: the newest page of a key's tests. A key gets at most 50 tests a
// day, so a page of 100 cannot be outrun between two polls.
const TESTS_PAGE = 100;
const REMEMBER = 300;
// Mailbox emails are read oldest first from a cursor, a page per poll.
const EMAILS_PAGE = 100;

export class EmailSpamTesterTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Email Spam Tester Trigger',
		name: 'emailSpamTesterTrigger',
		icon: { light: 'file:emailSpamTester.svg', dark: 'file:emailSpamTester.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle:
			'={{$parameter["event"] === "newMailboxEmail" ? "New Email in Permanent Mailbox" : "New Report"}}',
		description: 'Starts the workflow when an email has been checked by Email Spam Tester',
		defaults: { name: 'Email Spam Tester Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'emailSpamTesterApi', required: true }],
		properties: [
			{
				displayName: 'Trigger On',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'New Report',
						value: 'newReport',
						description: 'An email sent to one of your test addresses has been checked',
					},
					{
						name: 'New Email in Permanent Mailbox',
						value: 'newMailboxEmail',
						description: 'An email that arrived at a permanent mailbox has been checked',
					},
				],
				default: 'newReport',
			},
			{
				...mailboxLocator('', []),
				displayOptions: { show: { event: ['newMailboxEmail'] } },
			},
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				default: true,
				description: 'Whether to return a simplified version of the response instead of the raw data',
			},
		],
	};

	methods = { listSearch: { searchMailboxes } };

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const event = this.getNodeParameter('event') as string;
		const brief = this.getNodeParameter('simplify', true) as boolean;
		const manual = this.getMode() === 'manual';
		const state = this.getWorkflowStaticData('node');
		const out: INodeExecutionData[] = [];

		const emit = async (slug: string, letter: boolean, extra: IDataObject): Promise<boolean> => {
			const found = await fetchReport.call(this, slug, letter);
			// Expired or gone: nothing to hand on, and nothing to wait for either.
			if ('status' in found) return found.status !== 'waiting';
			out.push({
				json: brief
					? simplify(found.report, found.isPrivate)
					: { ...found.report, ...extra, private: found.isPrivate },
			});
			return true;
		};

		if (event === 'newMailboxEmail') {
			const value = this.getNodeParameter('mailboxId', '', { extractValue: true }) as string;
			const id = Number(String(value).trim());
			if (!Number.isInteger(id) || id <= 0) {
				throw new NodeOperationError(this.getNode(), `"${value}" is not a mailbox ID`, {
					description: 'Pick the mailbox from the list in the trigger.',
				});
			}
			const path = `/api/v1/installations/mailboxes/${id}/letters`;
			const key = `mailbox:${id}`;
			if (manual || state[key] === undefined) {
				// The newest checked email: a sample in the editor, the starting
				// point of the cursor on the first poll after activation.
				const body = (await apiRequest.call(this, 'GET', path, { account: ACCOUNT, newest: true, limit: 50 }))
					.body;
				const letters = (body.letters as IDataObject[]) ?? [];
				if (!manual) {
					state[key] = letters.length ? Number(letters[0].test_id) : 0;
					return null;
				}
				const sample = letters.find(settled);
				if (sample) await emit(String(sample.slug), true, { mailboxId: id, kind: sample.kind ?? null });
				return out.length ? [out] : null;
			}
			// Settled emails after the cursor, in arrival order. The API stops a
			// page at the first email still being checked, so none is skipped.
			const body = (
				await apiRequest.call(this, 'GET', path, {
					account: ACCOUNT,
					after_id: Number(state[key]),
					limit: EMAILS_PAGE,
					settled: true,
				})
			).body;
			for (const letter of (body.letters as IDataObject[]) ?? []) {
				// The plan follows the checks; wait for it rather than hand on half a report.
				if (!settled(letter) && letter.analysis_status === 'checks_ready') break;
				if (letter.analysis_status === 'checks_ready') {
					if (!(await emit(String(letter.slug), true, { mailboxId: id, kind: letter.kind ?? null }))) break;
				}
				state[key] = Number(letter.test_id);
			}
			return out.length ? [out] : null;
		}

		const body = (
			await apiRequest.call(this, 'GET', '/api/v1/installations/tests', {
				account: ACCOUNT,
				limit: TESTS_PAGE,
			})
		).body;
		const ready = ((body.tests as IDataObject[]) ?? []).filter(settled);
		if (manual) {
			if (ready.length) await emit(String(ready[0].slug), false, { domain: ready[0].domain ?? null });
			return out.length ? [out] : null;
		}
		if (state.reports === undefined) {
			// The first poll after activation hands on nothing: only what is checked from now on.
			state.reports = ready.map((t) => String(t.slug)).slice(0, REMEMBER);
			return null;
		}
		const seen = new Set<string>(state.reports as string[]);
		const handed: string[] = [];
		for (const test of ready.filter((t) => !seen.has(String(t.slug))).reverse()) {
			if (await emit(String(test.slug), false, { domain: test.domain ?? null })) {
				handed.push(String(test.slug));
			}
		}
		state.reports = [...handed.reverse(), ...(state.reports as string[])].slice(0, REMEMBER);
		return out.length ? [out] : null;
	}
}
