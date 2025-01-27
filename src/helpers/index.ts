import nodemailer from "nodemailer";
import HtmlToText from "html-to-text";

export const sendEmail = async (to: string, subject: string, html: string) => {
  const transporter = nodemailer.createTransport({
    host: "mail.eesast.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.NO_REPLY_EMAIL,
      pass: process.env.NO_REPLY_PASS
    }
  });

  const info = await transporter.sendMail({
    from: '"EESAST" <noreply@eesast.com>',
    to,
    subject,
    text: HtmlToText.fromString(html),
    html
  });

  console.log("Email %s sent to %s", info.messageId, to);
};
