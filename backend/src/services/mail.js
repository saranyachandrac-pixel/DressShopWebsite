const nodemailer = require('nodemailer');

function createTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendPasswordReset(email, temporaryPassword) {
  const transporter = createTransporter();
  const message = {
    from: process.env.SMTP_FROM || 'Dress Shop <no-reply@dressshop.local>',
    to: email,
    subject: 'Dress Shop password reset',
    text: `Your temporary password is: ${temporaryPassword}\nPlease login and change it soon.`
  };

  if (!transporter) {
    console.log('SMTP is not configured. Password reset email preview:', message);
    return;
  }

  await transporter.sendMail(message);
}

module.exports = { sendPasswordReset };

