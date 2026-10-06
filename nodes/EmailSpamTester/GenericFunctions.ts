import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeListSearchResult,
	IPollFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

// Every judgement (checks, scores, the fix plan) is made by the Email Spam
// Tester API. This package only carries requests and shapes the answers.
export const BASE = 'https://email-spam-tester.com';
export const KEY_PAGE = 'https://email-spam-tester.com/n8n/';
// One key keeps separate lists of tests and mailboxes per account name. All
// n8n workflows on a key share one list, apart from Zapier's.
export const ACCOUNT = 'n8n';
export const CREDENTIAL = 'emailSpamTesterApi';
// The longest the API holds a status request open (MAX_STATUS_WAIT).
const STATUS_HOLD = 50;
const SLUG = /^[A-Za-z0-9_-]{1,64}$/;

type Context = IExecuteFunctions | IPollFunctions | ILoadOptionsFunctions;

export interface Answer {
	statusCode: number;
	body: IDataObject;
}

function detail(body: IDataObject): string {
	const d = body.detail as unknown;
	if (!d) return '';
	if (typeof d === 'string') return d;
	if (Array.isArray(d)) {
		return d.map((e) => (e as IDataObject).msg ?? JSON.stringify(e)).join('; ');
	}
	const o = d as IDataObject;
	return String(o.message ?? o.error ?? JSON.stringify(o));
}

/** A call to the API with the key. Our error answers become messages that say what to do. */
export async function apiRequest(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	qs: IDataObject = {},
	body?: IDataObject,
	accept: number[] = [],
	timeout = 30000,
): Promise<Answer> {
	const options: IHttpRequestOptions = {
		method,
		url: `${BASE}${path}`,
		qs,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		timeout,
		headers: { 'User-Agent': 'EmailSpamTester-n8n' },
	};
	if (body !== undefined) options.body = body;
	const response = (await this.helpers.httpRequestWithAuthentication.call(
		this,
		CREDENTIAL,
		options,
	)) as { statusCode: number; body: unknown };
	const { statusCode } = response;
	// A proxy in between may answer with an HTML page rather than JSON.
	const answer = (
		response.body && typeof response.body === 'object' ? response.body : { body: String(response.body ?? '') }
	) as IDataObject;
	if (statusCode < 400 || accept.includes(statusCode)) return { statusCode, body: answer };
	const why = detail(answer);
	const fail = (message: string, description?: string) =>
		new NodeApiError(this.getNode(), answer as JsonObject, {
			message,
			description,
			httpCode: String(statusCode),
		});
	if (statusCode === 401) {
		throw fail(
			'The API key was not accepted',
			`Get a new key at ${KEY_PAGE} and paste it into the Email Spam Tester API credential.`,
		);
	}
	if (statusCode === 429) {
		throw fail('A daily limit of this key is used up', `${why || 'It opens again tomorrow'}.`);
	}
	if (statusCode === 409 && (answer.detail as IDataObject)?.error === 'mailbox_limit_reached') {
		const limit = (answer.detail as IDataObject).limit;
		throw fail(
			`This key already keeps ${limit} permanent mailboxes open`,
			'Close one with Permanent Mailbox › Close to create another.',
		);
	}
	throw fail(why || `Email Spam Tester answered ${statusCode}`);
}

/** A test ID as the API makes them, checked before it goes into a URL. */
export function slugOf(this: IExecuteFunctions, value: string, label: string, i: number): string {
	const slug = String(value ?? '').trim();
	if (!SLUG.test(slug)) {
		throw new NodeOperationError(this.getNode(), `"${slug}" is not a valid ${label}`, {
			description: `Use the '${label}' value returned by Email Spam Tester, such as yvo1ncmvizfad9vdtuns.`,
			itemIndex: i,
		});
	}
	return slug;
}

// What the API counts as not yet checked (mailboxes.service.UNSETTLED).
const UNSETTLED = new Set(['received', 'analyzing', 'deferred']);
const PROBLEM = new Set(['fail', 'error']);
const WARNING = new Set(['warn']);
const AI_BUSY = new Set(['pending', 'running']);

/** Out of the analysis queue: checked, failed or skipped as a repeat. */
export function done(item: IDataObject): boolean {
	return !UNSETTLED.has(String(item.analysis_status));
}

/** Checks are done and the AI plan is no longer being written. */
export function settled(item: IDataObject): boolean {
	return item.analysis_status === 'checks_ready' && !AI_BUSY.has(String(item.ai_status));
}

/** A report as the ten fields a Slack message or a spreadsheet row can take as they are. */
export function simplify(report: IDataObject, isPrivate = false): IDataObject {
	const checks = (report.checks as IDataObject[]) ?? [];
	const titles = (set: Set<string>) =>
		checks.filter((c) => set.has(String(c.status))).map((c) => String(c.title));
	const fixes = ((report.fixes as IDataObject[]) ?? [])
		.map((f) => ((f.fix as IDataObject)?.title as string) ?? (f.id as string))
		.filter(Boolean);
	const message = (report.message as IDataObject) ?? {};
	return {
		testId: report.slug,
		score: report.score_ours ?? null,
		score10: report.score_compat ?? null,
		subject: message.subject ?? null,
		from: message.from_addr ?? null,
		summary: report.ai_verdict ?? null,
		problems: titles(PROBLEM),
		warnings: titles(WARNING),
		fixes,
		reportUrl: isPrivate ? null : (report.report_url ?? `${BASE}/t/${report.slug}`),
	};
}

export type Found =
	| { report: IDataObject; isPrivate: boolean }
	| { status: 'waiting' | 'expired' | 'not found' };

/**
 * A report by its ID: a public test report, or else a private one from a
 * permanent mailbox of this key. Read in the language it was ordered in: asking
 * for another one would queue a translation and answer in the original anyway.
 */
export async function fetchReport(this: Context, slug: string, letter = false): Promise<Found> {
	const id = encodeURIComponent(slug);
	if (!letter) {
		const open = await apiRequest.call(this, 'GET', `/api/v1/tests/${id}`, {}, undefined, [202, 404, 410]);
		if (open.statusCode === 202) return { status: 'waiting' };
		if (open.statusCode === 410) return { status: 'expired' };
		if (open.statusCode !== 404) return { report: open.body, isPrivate: false };
	}
	const mail = await apiRequest.call(
		this,
		'GET',
		`/api/v1/installations/letters/${id}`,
		{ account: ACCOUNT },
		undefined,
		[404, 410],
	);
	if (mail.statusCode === 404) return { status: 'not found' };
	if (mail.statusCode === 410) return { status: 'expired' };
	return { report: mail.body, isPrivate: true };
}

/**
 * Waits for a test's checks (and the AI plan, if asked) by holding status
 * requests open at the API, so nothing sleeps here. Returns the last status.
 */
export async function waitForReport(
	this: IExecuteFunctions,
	slug: string,
	seconds: number,
	plan: boolean,
): Promise<string> {
	const deadline = Date.now() + seconds * 1000;
	const path = `/api/v1/tests/${encodeURIComponent(slug)}/status`;
	let last: IDataObject = {};
	for (;;) {
		const left = Math.floor((deadline - Date.now()) / 1000);
		const hold = Math.max(0, Math.min(STATUS_HOLD, left));
		const answer = await apiRequest.call(
			this,
			'GET',
			path,
			{ wait: hold, until: plan ? 'plan' : 'checks' },
			undefined,
			[202, 404, 410],
			(hold + 20) * 1000,
		);
		// 404: not a test address, maybe an email in a permanent mailbox.
		if (answer.statusCode === 404) return 'letter';
		if (answer.statusCode === 410) return 'expired';
		if (answer.statusCode === 200) last = answer.body;
		if (done(last) && (!plan || !AI_BUSY.has(String(last.ai_status)))) return 'ready';
		if (hold === 0) return 'waiting';
	}
}

/** Up to `limit` items (or all with limit 0) from a list the API pages with a cursor. */
export async function collect(
	this: Context,
	page: (cursor: string | number | undefined) => Promise<{
		items: IDataObject[];
		next: string | number | undefined;
	}>,
	limit: number,
): Promise<IDataObject[]> {
	const out: IDataObject[] = [];
	let cursor: string | number | undefined;
	for (;;) {
		const { items, next } = await page(cursor);
		out.push(...items);
		if (limit > 0 && out.length >= limit) return out.slice(0, limit);
		if (!items.length || next === undefined || next === null) return out;
		cursor = next;
	}
}

/** The key's permanent mailboxes for the From List picker. */
export async function searchMailboxes(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const answer = await apiRequest.call(this, 'GET', '/api/v1/installations/mailboxes', {
		account: ACCOUNT,
		limit: 500,
	});
	const needle = (filter ?? '').toLowerCase();
	const results = ((answer.body.mailboxes as IDataObject[]) ?? [])
		.filter((m) => !needle || `${m.domain} ${m.address}`.toLowerCase().includes(needle))
		.map((m) => ({
			name: `${m.domain} (${m.state === 'closed' ? 'closed' : m.address})`,
			value: String(m.id),
		}));
	return { results };
}
