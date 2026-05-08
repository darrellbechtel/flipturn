import type { Resend } from 'resend';
import { getLogger } from './logger.js';

export interface OutgoingEmail {
  readonly to: string;
  readonly subject: string;
  readonly htmlBody: string;
  readonly textBody: string;
}

export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
}

/** Production sender — uses Resend. */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly resend: Resend,
    private readonly from: string,
  ) {}

  async send(email: OutgoingEmail): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.from,
      to: email.to,
      subject: email.subject,
      html: email.htmlBody,
      text: email.textBody,
    });
    if (error) {
      throw new Error(`ResendEmailSender.send failed: ${JSON.stringify(error)}`);
    }
  }
}

/** Test/dev sender — captures emails in memory. */
export class InMemoryEmailSender implements EmailSender {
  private readonly _outbox: OutgoingEmail[] = [];

  get outbox(): readonly OutgoingEmail[] {
    return this._outbox;
  }

  async send(email: OutgoingEmail): Promise<void> {
    this._outbox.push(email);
    // When the api runs without a Resend key (typical for dev / a fresh
    // box / a closed-beta sandbox), the magic-link URL would otherwise be
    // unreachable. Surface the email body via the structured logger so
    // `pm2 logs flipturn-api` is enough to grab the link. Suppressed in
    // tests so vitest output stays focused on assertions.
    if (process.env.NODE_ENV !== 'test') {
      getLogger().info(
        { to: email.to, subject: email.subject, textBody: email.textBody },
        'InMemoryEmailSender captured email (no Resend key — magic link in textBody)',
      );
    }
  }

  latestTo(addr: string): OutgoingEmail | undefined {
    for (let i = this._outbox.length - 1; i >= 0; i--) {
      if (this._outbox[i]?.to === addr) {
        return this._outbox[i];
      }
    }
    return undefined;
  }

  clear(): void {
    this._outbox.length = 0;
  }
}
