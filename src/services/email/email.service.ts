import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
  const host = process.env.MAIL_HOST;
  const port = Number(process.env.MAIL_PORT || "587");
  const user = process.env.MAIL_USER;
  const password = process.env.MAIL_PASSWORD;

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !password) {
    throw new Error("Password recovery email is not configured.");
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass: password },
    });
  }
  return transporter;
};

export function assertPasswordRecoveryEmailConfigured(): void {
  if (!process.env.MAIL_FROM) throw new Error("MAIL_FROM is not configured.");
  getTransporter();
}

export async function sendPasswordRecoveryCode(
  email: string,
  code: string,
  scope: "citizen" | "admin",
): Promise<void> {
  assertPasswordRecoveryEmailConfigured();
  const from = process.env.MAIL_FROM;

  const audience = scope === "admin" ? "admin account" : "account";
  await getTransporter().sendMail({
    from,
    to: email,
    subject: "Your password reset code",
    text: `Your ${audience} password reset code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
    html: `<p>Your ${audience} password reset code is <strong>${code}</strong>.</p><p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
  });
}
