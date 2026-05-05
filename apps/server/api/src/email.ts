import type { Resend } from 'resend';

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
