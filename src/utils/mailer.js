const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false, // true for 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendOtpEmail(to, otp) {
  await transporter.sendMail({
    from: `"MeetUp" <${process.env.SMTP_USER}>`,
    to,
    subject: "Verify your email",
    html: `
      <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
              style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;
                     box-shadow:0 2px 8px rgba(0,0,0,0.06);">
              <tr>
                <td style="padding:28px 32px 8px;text-align:center;">
                  <h1 style="margin:0;font-size:20px;color:#111827;">Verify your email</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 32px 0;color:#374151;font-size:15px;line-height:1.6;">
                  <p style="margin:0 0 16px;">Hi there,</p>
                  <p style="margin:0 0 24px;">
                    Use the code below to finish setting up your MeetUp account.
                  </p>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding:0 32px 8px;">
                  <div style="display:inline-block;padding:14px 28px;border-radius:10px;
                              background:#f3f4f6;border:1px solid #e5e7eb;
                              font-size:32px;letter-spacing:8px;font-weight:700;color:#111827;">
                    ${otp}
                  </div>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 32px 0;color:#6b7280;font-size:13px;text-align:center;">
                  This code expires in <b>5 minutes</b>.
                </td>
              </tr>
              <tr>
                <td style="padding:24px 32px 28px;color:#9ca3af;font-size:12px;line-height:1.5;
                           border-top:1px solid #f3f4f6;">
                  If you didn't request this, you can safely ignore this email —
                  no one can access your account without this code.
                </td>
              </tr>
            </table>
            <p style="max-width:480px;margin:16px auto 0;color:#9ca3af;font-size:11px;text-align:center;">
              © ${new Date().getFullYear()} MeetUp
            </p>
          </td>
        </tr>
      </table>
    </body>
    `,
  });
}

module.exports = { sendOtpEmail };