/**
 * Optional SMTP email delivery (verification codes, reminder digests).
 *
 * Production honesty (user trust): when SMTP env vars are absent the code is
 * logged server-side and surfaced in the UI as an explicit DEV MODE code —
 * never silently pretending an email was sent.
 */
export async function sendVerificationEmail(to: string, code: string): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.log(`[mailer] SMTP not configured — verification code for ${to}: ${code}`);
    return false;
  }
  try {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === '1',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM || 'LifeOS <no-reply@lifeos.app>',
      to,
      subject: 'Your LifeOS verification code',
      text: `Your LifeOS verification code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`,
    });
    return true;
  } catch (err) {
    console.error('[mailer] send failed:', err);
    return false;
  }
}
