import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEmailSender } from '../src/email.js';

describe('InMemoryEmailSender', () => {
  let sender: InMemoryEmailSender;

  beforeEach(() => {
    sender = new InMemoryEmailSender();
  });

  it('captures sent emails', async () => {
    await sender.send({
      to: 'a@example.com',
      subject: 'Hello',
      htmlBody: '<p>Click here</p>',
      textBody: 'Click here',
    });
    expect(sender.outbox).toHaveLength(1);
    expect(sender.outbox[0]?.to).toBe('a@example.com');
    expect(sender.outbox[0]?.subject).toBe('Hello');
  });

  it('latestTo returns the most recent message to a given address', async () => {
    await sender.send({ to: 'a@example.com', subject: 'First', htmlBody: '', textBody: '' });
    await sender.send({ to: 'b@example.com', subject: 'Other', htmlBody: '', textBody: '' });
    await sender.send({ to: 'a@example.com', subject: 'Second', htmlBody: '', textBody: '' });
    expect(sender.latestTo('a@example.com')?.subject).toBe('Second');
    expect(sender.latestTo('a@example.com')?.subject).not.toBe('First');
  });

  it('clear() resets the outbox', async () => {
    await sender.send({ to: 'a@example.com', subject: 'X', htmlBody: '', textBody: '' });
    sender.clear();
    expect(sender.outbox).toHaveLength(0);
  });
});
