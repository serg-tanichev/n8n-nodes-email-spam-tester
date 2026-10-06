# n8n-nodes-email-spam-tester

n8n nodes for [Email Spam Tester](https://email-spam-tester.com/), a free email deliverability tester. A workflow creates a test address, sends an email to it through whatever node normally sends your mail (Gmail, SMTP, an ESP), and gets back a score, the problems found and a fix plan. With the folder check it also learns whether the email landed in Inbox, Promotions or Spam at different email providers. A permanent mailbox, subscribed to your own newsletter, gets every issue checked as it arrives.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

## Installation

In n8n, open **Settings › Community Nodes**, choose **Install** and enter `n8n-nodes-email-spam-tester`. The [community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/) has the details for self-hosted instances.

## Credentials

The nodes use a personal API key. Get one for free at [email-spam-tester.com/n8n](https://email-spam-tester.com/n8n/): type your email address and the key appears on the page. Nothing is mailed and there is no password; a lost key is replaced by asking again, and old keys keep working. In n8n, create an **Email Spam Tester API** credential and paste the key.

## Operations

**Email Spam Tester** node:

| Resource | Operation | What it does |
|---|---|---|
| Test Address | Create | A single-use address, valid for an hour. With **Check Folder at Email Providers** on, it also returns about 30 test mailboxes and a marker to put in the subject. |
| Report | Get | The report on the email sent to a test address, or to a permanent mailbox. It can wait for the email to arrive (up to 15 minutes) and for the AI fix plan. |
| Report | Get Many | Reports on emails sent to your test addresses, newest first, with what changed since the previous test of the same domain. |
| Folder Check | Get | Inbox, Promotions, Spam or not received, per provider. |
| Permanent Mailbox | Create, Get, Get Many, Close | An address that does not expire, for one sending domain. |
| Permanent Mailbox | Get Emails | The emails that arrived there, with their scores. |

**Email Spam Tester Trigger** starts a workflow on **New Report** (an email sent to one of your test addresses has been checked) or **New Email in Permanent Mailbox**.

With **Simplify** on (the default) a report comes out as ten fields: `testId`, `score` (out of 100), `score10` (the classic 0 to 10), `subject`, `from`, `summary`, `problems`, `warnings`, `fixes` and `reportUrl`. Switch it off for the full report with every check and its evidence.

The node can also be used as a tool by an AI agent.

## Usage

Test a template before a campaign goes out:

1. **Email Spam Tester**: Test Address › Create.
2. **Send Email** (or Gmail): send the template to `{{ $json.address }}`.
3. **Email Spam Tester**: Report › Get, Test ID `{{ $('Email Spam Tester').item.json.testId }}`, Wait for Report on.
4. **If** `score` is below 70, post `problems` and `fixes` to Slack; otherwise let the campaign go.

For the folder check, switch it on in step 1, send to every address in `recipients` with `marker` in the subject, and read the result about half an hour later with Folder Check › Get. The Gmail mailboxes are public test mailboxes: anyone there can see the subject, the sender name and the folder, so keep confidential email out of the folder check.

To watch a newsletter, create a permanent mailbox for its sending domain, subscribe the address to the newsletter, and start a workflow with the trigger's **New Email in Permanent Mailbox**.

## Limits and data

Each key gets 50 tests a day, 3 of them with the folder check, and up to 5 permanent mailboxes that take 300 emails a day each. Test reports are public to anyone with their link, like on the site. Reports on emails to a permanent mailbox are private and open only with your key; the email itself is deleted two days after it arrives and its report after 90 days. See the [privacy policy](https://email-spam-tester.com/privacy/) and the [API reference](https://email-spam-tester.com/api-docs/).

## Compatibility

Built with `@n8n/node-cli` and tested on n8n 2.38. No runtime dependencies.

## Resources

- [Email Spam Tester for n8n](https://email-spam-tester.com/n8n/)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- Questions and bug reports: [hi@email-spam-tester.com](mailto:hi@email-spam-tester.com) or an issue on [GitHub](https://github.com/serg-tanichev/n8n-nodes-email-spam-tester/issues)

## Version history

See [CHANGELOG.md](CHANGELOG.md).
