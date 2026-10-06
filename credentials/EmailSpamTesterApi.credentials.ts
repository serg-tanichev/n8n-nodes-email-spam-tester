import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class EmailSpamTesterApi implements ICredentialType {
	name = 'emailSpamTesterApi';

	displayName = 'Email Spam Tester API';

	icon: Icon = {
		light: 'file:../nodes/EmailSpamTester/emailSpamTester.svg',
		dark: 'file:../nodes/EmailSpamTester/emailSpamTester.dark.svg',
	};

	documentationUrl = 'https://email-spam-tester.com/n8n/';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'e.g. est_live_…',
			description:
				'A free personal key from https://email-spam-tester.com/n8n/. It needs only your email address.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://email-spam-tester.com',
			url: '/api/v1/keys/me',
		},
	};
}
