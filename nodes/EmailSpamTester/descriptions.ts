import type { INodeProperties } from 'n8n-workflow';

const LANGUAGES = [
	['English', 'en'],
	['Arabic', 'ar'],
	['Chinese', 'zh'],
	['Dutch', 'nl'],
	['French', 'fr'],
	['German', 'de'],
	['Italian', 'it'],
	['Japanese', 'ja'],
	['Polish', 'pl'],
	['Portuguese', 'pt'],
	['Russian', 'ru'],
	['Spanish', 'es'],
	['Turkish', 'tr'],
	['Ukrainian', 'uk'],
].map(([name, value]) => ({ name, value }));

const show = (resource: string, operation: string[]) => ({
	show: { resource: [resource], operation },
});

export const mailboxLocator = (resource: string, operation: string[]): INodeProperties => ({
	displayName: 'Mailbox',
	name: 'mailboxId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	description: 'A permanent mailbox made with Permanent Mailbox › Create',
	displayOptions: show(resource, operation),
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchMailboxes', searchable: true },
		},
		{
			displayName: 'ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 42',
			validation: [
				{
					type: 'regex',
					properties: { regex: '^[0-9]+$', errorMessage: 'A mailbox ID is a number' },
				},
			],
		},
	],
});

const returnAll = (resource: string, operation: string): INodeProperties[] => [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: show(resource, [operation]),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: [resource], operation: [operation], returnAll: [false] } },
	},
];

const simplify = (resource: string, operation: string[]): INodeProperties => ({
	displayName: 'Simplify',
	name: 'simplify',
	type: 'boolean',
	default: true,
	description: 'Whether to return a simplified version of the response instead of the raw data',
	displayOptions: show(resource, operation),
});

export const resource: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{ name: 'Folder Check', value: 'folderCheck' },
		{ name: 'Permanent Mailbox', value: 'mailbox' },
		{ name: 'Report', value: 'report' },
		{ name: 'Test Address', value: 'testAddress' },
	],
	default: 'testAddress',
};

export const operations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['testAddress'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a single-use address to send one email to',
				action: 'Create test address',
			},
		],
		default: 'create',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['report'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve the report on an email, waiting for it if needed',
				action: 'Get report',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Retrieve a list of reports on emails sent to your test addresses',
				action: 'Get many reports',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['folderCheck'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve the folder the email landed in at each email provider',
				action: 'Get folder check',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['mailbox'] } },
		options: [
			{
				name: 'Close',
				value: 'close',
				description: 'Stop checking new emails that arrive at a permanent mailbox',
				action: 'Close permanent mailbox',
			},
			{
				name: 'Create',
				value: 'create',
				description: 'Create a permanent address for one sending domain',
				action: 'Create permanent mailbox',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve a permanent mailbox',
				action: 'Get permanent mailbox',
			},
			{
				name: 'Get Emails',
				value: 'getEmails',
				description: 'List the emails that arrived at a permanent mailbox, with their scores',
				action: 'Get emails in permanent mailbox',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Retrieve a list of your permanent mailboxes',
				action: 'Get many permanent mailboxes',
			},
		],
		default: 'create',
	},
];

export const fields: INodeProperties[] = [
	// Test Address › Create
	{
		displayName: 'Check Folder at Email Providers',
		name: 'checkFolders',
		type: 'boolean',
		default: false,
		description:
			'Whether to also get test mailboxes at different email providers. Send the same email to all of them, with the marker in the subject, and Folder Check › Get shows Inbox, Promotions or Spam for each provider. The Gmail mailboxes are public test mailboxes: anyone there can see the subject, the sender name and the folder, so keep confidential email out of it.',
		displayOptions: show('testAddress', ['create']),
	},
	{
		displayName: 'Report Language',
		name: 'language',
		type: 'options',
		options: LANGUAGES,
		default: 'en',
		description: 'The language of the findings and the fix plan',
		displayOptions: show('testAddress', ['create']),
	},

	// Report › Get
	{
		displayName: 'Test ID',
		name: 'testId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. yvo1ncmvizfad9vdtuns',
		description:
			"The 'testId' from Test Address › Create, or of an email in a permanent mailbox",
		displayOptions: show('report', ['get']),
	},
	{
		displayName: 'Wait for Report',
		name: 'wait',
		type: 'boolean',
		default: true,
		description:
			'Whether to wait until the email has arrived and been checked. Without it, an email that has not arrived yet gives an item with status "waiting".',
		displayOptions: show('report', ['get']),
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show('report', ['get']),
		options: [
			{
				displayName: 'Wait Up To (Seconds)',
				name: 'waitSeconds',
				type: 'number',
				typeOptions: { minValue: 10, maxValue: 900 },
				default: 300,
				description: 'How long to wait for the email before returning status "waiting"',
			},
			{
				displayName: 'Wait for Fix Plan',
				name: 'waitForPlan',
				type: 'boolean',
				default: false,
				description:
					'Whether to also wait for the AI fix plan, which follows the checks by a minute or so',
			},
		],
	},
	simplify('report', ['get', 'getAll']),

	// Report › Get Many
	...returnAll('report', 'getAll'),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show('report', ['getAll']),
		options: [
			{
				displayName: 'Sending Domain',
				name: 'domain',
				type: 'string',
				default: '',
				placeholder: 'e.g. example.com',
				description: 'Only reports on emails from this domain',
			},
		],
	},

	// Folder Check › Get
	{
		displayName: 'Folder Check ID',
		name: 'folderCheckId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 42mO5I4PNYQV48GexaKjyR06logQAUPl',
		description: "The 'folderCheckId' from Test Address › Create with the folder check on",
		displayOptions: show('folderCheck', ['get']),
	},

	// Permanent Mailbox
	{
		displayName: 'Sending Domain',
		name: 'domain',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. example.com',
		description:
			'The domain the emails come from. Asking again for the same domain returns the same address.',
		displayOptions: show('mailbox', ['create']),
	},
	mailboxLocator('mailbox', ['get', 'close', 'getEmails']),
	...returnAll('mailbox', 'getAll'),
	...returnAll('mailbox', 'getEmails'),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show('mailbox', ['getAll']),
		options: [
			{
				displayName: 'State',
				name: 'state',
				type: 'options',
				options: [
					{ name: 'Open', value: 'active' },
					{ name: 'Closed', value: 'closed' },
				],
				default: 'active',
			},
		],
	},
	{
		displayName: 'Options',
		name: 'emailOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show('mailbox', ['getEmails']),
		options: [
			{
				displayName: 'Include Emails Being Checked',
				name: 'includeUnsettled',
				type: 'boolean',
				default: false,
				description: 'Whether to include emails whose checks or fix plan are not done yet',
			},
			{
				displayName: 'Oldest First',
				name: 'oldestFirst',
				type: 'boolean',
				default: false,
				description: 'Whether to start with the oldest email instead of the newest',
			},
		],
	},
];
