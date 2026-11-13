import { type SendEmailCommand } from '@aws-sdk/client-sesv2';
import { type PinoLogger } from 'nestjs-pino';
import { SesEmailDriver, type OutgoingEmail } from './email-driver';

const email: OutgoingEmail = {
  to: 'dana@example.com',
  from: 'HilaTech <no-reply@example.com>',
  subject: 'אימות כתובת האימייל',
  text: 'פתחו את הקישור: https://app.example.com/verify-email?token=secret-token',
  html: '<p>פתחו את הקישור</p>',
  template: 'verify_email',
  idempotencyKey: 'email-verify-1',
  organizationId: null,
  secrets: ['secret-token'],
};

describe('SesEmailDriver', () => {
  it('sends subject, text and html as UTF-8 to one recipient and returns the SES message id', async () => {
    const info = jest.fn();
    const driver = new SesEmailDriver({ info } as unknown as PinoLogger);
    const sent: SendEmailCommand[] = [];
    driver.client = {
      send: async (command) => {
        sent.push(command);
        return { MessageId: 'ses-123' };
      },
    };

    const result = await driver.send(email);

    expect(result).toEqual({ driver: 'ses', messageId: 'ses-123' });
    const input = sent[0]!.input;
    expect(input.FromEmailAddress).toBe(email.from);
    expect(input.Destination?.ToAddresses).toEqual(['dana@example.com']);
    expect(input.Content?.Simple?.Subject).toEqual({ Data: email.subject, Charset: 'UTF-8' });
    expect(input.Content?.Simple?.Body?.Html?.Data).toBe(email.html);
    expect(input.Content?.Simple?.Body?.Text?.Data).toBe(email.text);
  });

  it('never writes the token to the log', async () => {
    const info = jest.fn();
    const driver = new SesEmailDriver({ info } as unknown as PinoLogger);
    driver.client = { send: async () => ({}) };
    expect((await driver.send(email)).messageId).toBeNull();
    expect(JSON.stringify(info.mock.calls)).not.toContain('secret-token');
  });

  it('lets an SES failure reach the queue so the job is retried', async () => {
    const driver = new SesEmailDriver({ info: jest.fn() } as unknown as PinoLogger);
    driver.client = {
      send: async () => {
        throw new Error('MessageRejected: Email address is not verified');
      },
    };
    await expect(driver.send(email)).rejects.toThrow(/MessageRejected/);
  });
});
