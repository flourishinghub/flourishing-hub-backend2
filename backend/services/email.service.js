import nodemailer from "nodemailer";
import { ApiError } from "../utils/ApiError.js";
import { StatusCodes } from "http-status-codes";

// Create transporter
const createTransporter = () => {
  // Check if email credentials are configured
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.warn("Email credentials not configured. Email sending will be skipped.");
    return null;
  }

  const maskedUser = process.env.EMAIL_USER.replace(/^(.{3}).*(@.*)$/, "$1***$2");
  console.log(`Email transporter configured for ${maskedUser} (app password length: ${process.env.EMAIL_PASSWORD.length} chars)`);

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });
};

// Generate 6-digit OTP
export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP email
export const sendOTPEmail = async (email, name, otp) => {
  try {
    const transporter = createTransporter();
    
    // If email is not configured, log OTP to console (development mode)
    if (!transporter) {
      console.log(`\n========== OTP FOR ${email} ==========`);
      console.log(`Name: ${name}`);
      console.log(`OTP: ${otp}`);
      console.log(`Valid for: 10 minutes`);
      console.log(`==========================================\n`);
      return true;
    }

    const mailOptions = {
      from: `"Flourishing Hub, IIT Bombay" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Verify Your Email - Flourishing Hub",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f9f9f9;
            }
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 30px;
              text-align: center;
              border-radius: 10px 10px 0 0;
            }
            .content {
              background: white;
              padding: 30px;
              border-radius: 0 0 10px 10px;
            }
            .otp-box {
              background: #f0f0f0;
              border: 2px dashed #667eea;
              padding: 20px;
              text-align: center;
              font-size: 32px;
              font-weight: bold;
              letter-spacing: 8px;
              color: #667eea;
              margin: 20px 0;
              border-radius: 8px;
            }
            .footer {
              text-align: center;
              margin-top: 20px;
              font-size: 12px;
              color: #666;
            }
            .tagline {
              font-style: italic;
              color: #667eea;
              margin-top: 10px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Flourishing Hub</h1>
              <p>IIT Bombay</p>
              <p class="tagline">Let's Thrive, Not Just Survive</p>
            </div>
            <div class="content">
              <h2>Hello ${name},</h2>
              <p>Thank you for signing up with Flourishing Hub! To complete your registration, please verify your email address.</p>
              
              <p>Your One-Time Password (OTP) is:</p>
              <div class="otp-box">${otp}</div>
              
              <p><strong>This OTP is valid for 10 minutes.</strong></p>
              
              <p>If you didn't request this verification, please ignore this email.</p>
              
              <p>Best regards,<br>Flourishing Hub Team<br>IIT Bombay</p>
            </div>
            <div class="footer">
              <p>This is an automated email. Please do not reply to this message.</p>
              <p>&copy; ${new Date().getFullYear()} Flourishing Hub, IIT Bombay. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Error sending OTP email:", error);
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to send verification email");
  }
};

// Send welcome email after verification
export const sendWelcomeEmail = async (email, name, role) => {
  try {
    const transporter = createTransporter();
    
    // If email is not configured, skip welcome email
    if (!transporter) {
      console.log(`Welcome email skipped for ${email} (email not configured)`);
      return true;
    }

    const mailOptions = {
      from: `"Flourishing Hub, IIT Bombay" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Welcome to Flourishing Hub!",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f9f9f9;
            }
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 30px;
              text-align: center;
              border-radius: 10px 10px 0 0;
            }
            .content {
              background: white;
              padding: 30px;
              border-radius: 0 0 10px 10px;
            }
            .tagline {
              font-style: italic;
              color: white;
              margin-top: 10px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to Flourishing Hub</h1>
              <p>IIT Bombay</p>
              <p class="tagline">Let's Thrive, Not Just Survive</p>
            </div>
            <div class="content">
              <h2>Hello ${name},</h2>
              <p>Your email has been successfully verified! Welcome to the Flourishing Hub community.</p>
              
              <p>As a <strong>${role}</strong>, you now have access to:</p>
              <ul>
                <li>Upcoming workshops and events</li>
                <li>Video library with valuable content</li>
                <li>Your personalized dashboard</li>
                <li>Community engagement opportunities</li>
              </ul>
              
              <p>We're excited to have you on this journey of growth and well-being.</p>
              
              <p>Best regards,<br>Flourishing Hub Team<br>IIT Bombay</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Error sending welcome email:", error);
    // Don't throw error for welcome email failure
    return false;
  }
};


// Send approval email
export const sendApprovalEmail = async (email, name) => {
  try {
    const transporter = createTransporter();
    
    if (!transporter) {
      console.log(`Approval email skipped for ${email} (email not configured)`);
      return true;
    }

    const mailOptions = {
      from: `"Flourishing Hub, IIT Bombay" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Account Approved - Flourishing Hub",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
            .tagline { font-style: italic; color: white; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Account Approved</h1>
              <p>IIT Bombay</p>
              <p class="tagline">Let's Thrive, Not Just Survive</p>
            </div>
            <div class="content">
              <h2>Hello ${name},</h2>
              <p>Great news! Your Flourishing Hub account has been approved by the admin.</p>
              
              <p>You can now login and access all features:</p>
              <ul>
                <li>Upcoming workshops and events</li>
                <li>Video library with valuable content</li>
                <li>Your personalized dashboard</li>
                <li>Community engagement opportunities</li>
              </ul>
              
              <a href="${process.env.CLIENT_URL || 'https://flourishing-hub-frontend2.vercel.app'}/login" class="button">Login Now</a>
              
              <p>We're excited to have you on this journey of growth and well-being.</p>
              
              <p>Best regards,<br>Flourishing Hub Team<br>IIT Bombay</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Error sending approval email:", error);
    return false;
  }
};

// Send decline email
export const sendDeclineEmail = async (email, name, reason) => {
  try {
    const transporter = createTransporter();
    
    if (!transporter) {
      console.log(`Decline email skipped for ${email} (email not configured)`);
      return true;
    }

    const mailOptions = {
      from: `"Flourishing Hub, IIT Bombay" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Account Registration Update - Flourishing Hub",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border-radius: 0 0 10px 10px; }
            .tagline { font-style: italic; color: white; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Flourishing Hub</h1>
              <p>IIT Bombay</p>
              <p class="tagline">Let's Thrive, Not Just Survive</p>
            </div>
            <div class="content">
              <h2>Hello ${name},</h2>
              <p>Thank you for your interest in Flourishing Hub.</p>
              
              <p>After review, we regret to inform you that your account registration could not be approved at this time.</p>
              
              ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
              
              <p>If you believe this is an error or have questions, please contact the Flourishing Hub team at IIT Bombay.</p>
              
              <p>Best regards,<br>Flourishing Hub Team<br>IIT Bombay</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Error sending decline email:", error);
    return false;
  }
};


// Send registration confirmation email
export const sendRegistrationConfirmationEmail = async (email, name, eventTitle, eventDate, eventVenue) => {
  try {
    const transporter = createTransporter();
    if (!transporter) {
      console.log(`Registration email skipped for ${email} (email not configured)`);
      return true;
    }
    const formattedDate = new Date(eventDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const mailOptions = {
      from: `"Flourishing Hub, IIT Bombay" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `Registration Confirmed: ${eventTitle}`,
      html: `
        <!DOCTYPE html><html><head><style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: white; padding: 30px; border-radius: 0 0 10px 10px; }
          .event-box { background: #f0f7ff; border-left: 4px solid #667eea; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0; }
          .tagline { font-style: italic; color: white; margin-top: 10px; }
        </style></head><body>
          <div class="container">
            <div class="header">
              <h1>Registration Confirmed</h1>
              <p>IIT Bombay</p>
              <p class="tagline">Let's Thrive, Not Just Survive</p>
            </div>
            <div class="content">
              <h2>Hello ${name},</h2>
              <p>You have successfully registered for the following workshop:</p>
              <div class="event-box">
                <p><strong>Workshop:</strong> ${eventTitle}</p>
                <p><strong>Date & Time:</strong> ${formattedDate} IST</p>
                <p><strong>Venue:</strong> ${eventVenue || 'TBD'}</p>
              </div>
              <p>Please arrive on time. You will need to check in on the website when the session goes live.</p>
              <p>Best regards,<br>Flourishing Hub Team<br>IIT Bombay</p>
            </div>
          </div>
        </body></html>
      `
    };
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Error sending registration email:", error);
    return false;
  }
};

// Send reminder email (24h before event)
export const sendReminderEmail = async (email, name, eventTitle, eventDate, eventVenue) => {
  try {
    const transporter = createTransporter();
    if (!transporter) {
      console.log(`Reminder email skipped for ${email} (email not configured)`);
      return true;
    }
    const formattedDate = new Date(eventDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const mailOptions = {
      from: `"Flourishing Hub, IIT Bombay" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `Reminder: ${eventTitle} is Tomorrow!`,
      html: `
        <!DOCTYPE html><html><head><style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
          .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: white; padding: 30px; border-radius: 0 0 10px 10px; }
          .event-box { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0; }
          .tagline { font-style: italic; color: white; margin-top: 10px; }
        </style></head><body>
          <div class="container">
            <div class="header">
              <h1>Workshop Reminder</h1>
              <p>IIT Bombay</p>
              <p class="tagline">Let's Thrive, Not Just Survive</p>
            </div>
            <div class="content">
              <h2>Hello ${name},</h2>
              <p>This is a friendly reminder that you have a workshop <strong>tomorrow</strong>:</p>
              <div class="event-box">
                <p><strong>Workshop:</strong> ${eventTitle}</p>
                <p><strong>Date & Time:</strong> ${formattedDate} IST</p>
                <p><strong>Venue:</strong> ${eventVenue || 'TBD'}</p>
              </div>
              <p>Remember to check in on the Flourishing Hub website when the session goes live.</p>
              <p>Best regards,<br>Flourishing Hub Team<br>IIT Bombay</p>
            </div>
          </div>
        </body></html>
      `
    };
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Error sending reminder email:", error);
    return false;
  }
};

// Send "today" reminder email — morning-of, for events happening later the
// same day (separate from sendReminderEmail's 24h/1h-before wording, which
// always says "tomorrow"/relative time and would read wrong for this one).
export const sendTodayReminderEmail = async (email, name, eventTitle, eventDate, eventVenue) => {
  try {
    const transporter = createTransporter();
    if (!transporter) {
      console.log(`Today-reminder email skipped for ${email} (email not configured)`);
      return true;
    }
    const formattedTime = new Date(eventDate).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const mailOptions = {
      from: `"Flourishing Hub, IIT Bombay" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `Today: ${eventTitle} at ${formattedTime} IST`,
      html: `
        <!DOCTYPE html><html><head><style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
          .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: white; padding: 30px; border-radius: 0 0 10px 10px; }
          .event-box { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0; }
          .tagline { font-style: italic; color: white; margin-top: 10px; }
        </style></head><body>
          <div class="container">
            <div class="header">
              <h1>Today's Workshop</h1>
              <p>IIT Bombay</p>
              <p class="tagline">Let's Thrive, Not Just Survive</p>
            </div>
            <div class="content">
              <h2>Good morning ${name},</h2>
              <p>This is a reminder that you have a workshop <strong>today</strong>:</p>
              <div class="event-box">
                <p><strong>Workshop:</strong> ${eventTitle}</p>
                <p><strong>Time:</strong> ${formattedTime} IST</p>
                <p><strong>Venue:</strong> ${eventVenue || 'TBD'}</p>
              </div>
              <p>Remember to check in on the Flourishing Hub website when the session goes live.</p>
              <p>Best regards,<br>Flourishing Hub Team<br>IIT Bombay</p>
            </div>
          </div>
        </body></html>
      `
    };
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Error sending today-reminder email:", error);
    return false;
  }
};

// Send session-completed email — 5 minutes after an event's endAt, once
// per event, to everyone who was registered/assigned to it.
export const sendSessionCompletedEmail = async (email, name, eventTitle, eventDate, eventVenue) => {
  try {
    const transporter = createTransporter();
    if (!transporter) {
      console.log(`Session-completed email skipped for ${email} (email not configured)`);
      return true;
    }
    const formattedDate = new Date(eventDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const mailOptions = {
      from: `"Flourishing Hub, IIT Bombay" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `Session Completed: ${eventTitle}`,
      html: `
        <!DOCTYPE html><html><head><style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
          .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: white; padding: 30px; border-radius: 0 0 10px 10px; }
          .event-box { background: #f0fdf4; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0; }
          .tagline { font-style: italic; color: white; margin-top: 10px; }
        </style></head><body>
          <div class="container">
            <div class="header">
              <h1>Session Completed</h1>
              <p>IIT Bombay</p>
              <p class="tagline">Let's Thrive, Not Just Survive</p>
            </div>
            <div class="content">
              <h2>Hello ${name},</h2>
              <p>This workshop has now ended:</p>
              <div class="event-box">
                <p><strong>Workshop:</strong> ${eventTitle}</p>
                <p><strong>Date & Time:</strong> ${formattedDate} IST</p>
                <p><strong>Venue:</strong> ${eventVenue || 'TBD'}</p>
              </div>
              <p>You can view your check-in status, quiz score and feedback for this session on your Flourishing Hub dashboard.</p>
              <p>Best regards,<br>Flourishing Hub Team<br>IIT Bombay</p>
            </div>
          </div>
        </body></html>
      `
    };
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Error sending session-completed email:", error);
    return false;
  }
};

// Send quiz result email (pass or fail)
export const sendQuizResultEmail = async (email, name, eventTitle, passed, score, passingScore) => {
  try {
    const transporter = createTransporter();
    if (!transporter) return true;
    const color = passed ? '#10b981' : '#ef4444';
    const badge = passed ? 'Workshop Completed' : 'Workshop Unsuccessful';
    const mailOptions = {
      from: `"Flourishing Hub, IIT Bombay" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: passed ? `Completed: Milestone Passed for ${eventTitle}` : `Action Required: Attendance Resolution for ${eventTitle}`,
      html: `<!DOCTYPE html><html><head><style>
        body{font-family:Arial,sans-serif;line-height:1.6;color:#333}
        .container{max-width:600px;margin:0 auto;padding:20px;background:#f9f9f9}
        .header{background:${color};color:white;padding:30px;text-align:center;border-radius:10px 10px 0 0}
        .content{background:white;padding:30px;border-radius:0 0 10px 10px}
        .box{background:${passed ? '#f0fdf4' : '#fef2f2'};border-left:4px solid ${color};padding:15px;margin:20px 0;border-radius:0 8px 8px 0}
      </style></head><body><div class="container">
        <div class="header"><h1>${badge}</h1><p>IIT Bombay Flourishing Hub</p></div>
        <div class="content">
          <h2>Hello ${name},</h2>
          ${passed
            ? `<p>Congratulations! You have successfully completed the workshop and your transcript has been updated.</p>`
            : `<p>Unfortunately, you did not meet the passing criteria for this workshop. We encourage you to register again.</p>`}
          <div class="box">
            <p><strong>Workshop:</strong> ${eventTitle}</p>
            <p><strong>Your Score:</strong> ${score} / 5</p>
            <p><strong>Passing Score:</strong> ${passingScore} / 5</p>
            <p><strong>Result:</strong> ${passed ? 'PASSED' : 'FAILED'}</p>
          </div>
          ${!passed ? `<p>You can register for a repeated session of this workshop via the course catalog.</p>` : ''}
          <p>Best regards,<br>Flourishing Hub Team<br>IIT Bombay</p>
        </div>
      </div></body></html>`
    };
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Error sending quiz result email:", error);
    return false;
  }
};

// Send course bundle registration email
export const sendCourseBundleEmail = async (email, name, courseTitle, courseCode, workshopTitles) => {
  try {
    const transporter = createTransporter();
    if (!transporter) return true;
    const workshopList = workshopTitles.map((t, i) => `<li>${i + 1}. ${t}</li>`).join('');
    const mailOptions = {
      from: `"Flourishing Hub, IIT Bombay" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `Confirmation: Enrollment in ${courseTitle}`,
      html: `<!DOCTYPE html><html><head><style>
        body{font-family:Arial,sans-serif;line-height:1.6;color:#333}
        .container{max-width:600px;margin:0 auto;padding:20px;background:#f9f9f9}
        .header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:30px;text-align:center;border-radius:10px 10px 0 0}
        .content{background:white;padding:30px;border-radius:0 0 10px 10px}
        .box{background:#f0f7ff;border-left:4px solid #667eea;padding:15px;margin:20px 0;border-radius:0 8px 8px 0}
        ul{margin:8px 0;padding-left:20px}
      </style></head><body><div class="container">
        <div class="header"><h1>Course Enrollment Confirmed</h1><p>IIT Bombay Flourishing Hub</p></div>
        <div class="content">
          <h2>Hello ${name},</h2>
          <p>You have been successfully enrolled in the following course bundle:</p>
          <div class="box">
            <p><strong>Course:</strong> ${courseTitle}${courseCode ? ` (${courseCode})` : ''}</p>
            <p><strong>Enrolled Workshops:</strong></p>
            <ul>${workshopList}</ul>
          </div>
          <p>You are now registered for all ${workshopTitles.length} workshops above. Details will appear on your dashboard.</p>
          <p>Best regards,<br>Flourishing Hub Team<br>IIT Bombay</p>
        </div>
      </div></body></html>`
    };
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Error sending course bundle email:", error);
    return false;
  }
};

// Send staff assignment email (Instructor / Associate Instructor / Volunteer)
export const sendStaffAssignmentEmail = async (email, name, role, eventTitle, eventDate, eventVenue) => {
  try {
    const transporter = createTransporter();
    if (!transporter) return true;
    const roleLabel = role === "INSTRUCTOR" ? "Instructor" : role === "ASSOCIATE_INSTRUCTOR" ? "Associate Instructor" : "Volunteer";
    const formattedDate = new Date(eventDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const mailOptions = {
      from: `"Flourishing Hub, IIT Bombay" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `You've Been Assigned as ${roleLabel}: ${eventTitle}`,
      html: `<!DOCTYPE html><html><head><style>
        body{font-family:Arial,sans-serif;line-height:1.6;color:#333}
        .container{max-width:600px;margin:0 auto;padding:20px;background:#f9f9f9}
        .header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:30px;text-align:center;border-radius:10px 10px 0 0}
        .content{background:white;padding:30px;border-radius:0 0 10px 10px}
        .box{background:#f0f7ff;border-left:4px solid #667eea;padding:15px;margin:20px 0;border-radius:0 8px 8px 0}
      </style></head><body><div class="container">
        <div class="header"><h1>New Assignment</h1><p>IIT Bombay Flourishing Hub</p></div>
        <div class="content">
          <h2>Hello ${name},</h2>
          <p>You have been assigned as <strong>${roleLabel}</strong> for the following workshop:</p>
          <div class="box">
            <p><strong>Workshop:</strong> ${eventTitle}</p>
            <p><strong>Date & Time:</strong> ${formattedDate} IST</p>
            <p><strong>Venue:</strong> ${eventVenue || 'TBD'}</p>
          </div>
          <p>Details are available on your Flourishing Hub dashboard.</p>
          <p>Best regards,<br>Flourishing Hub Team<br>IIT Bombay</p>
        </div>
      </div></body></html>`
    };
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Error sending staff assignment email:", error);
    return false;
  }
};

// Send password reset email
export const sendPasswordResetEmail = async (email, name, resetLink) => {
  try {
    const transporter = createTransporter();
    if (!transporter) {
      console.log(`\n========== PASSWORD RESET LINK ==========`);
      console.log(`Email: ${email}`);
      console.log(`Link: ${resetLink}`);
      console.log(`Valid for: 15 minutes`);
      console.log(`=========================================\n`);
      return true;
    }
    const mailOptions = {
      from: `"Flourishing Hub, IIT Bombay" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Reset Your Password - Flourishing Hub",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: bold; }
            .warning { background: #fff3cd; border-left: 4px solid #f59e0b; padding: 12px 15px; margin: 20px 0; border-radius: 0 8px 8px 0; font-size: 14px; }
            .tagline { font-style: italic; color: white; margin-top: 10px; }
            .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Password Reset</h1>
              <p>IIT Bombay</p>
              <p class="tagline">Let's Thrive, Not Just Survive</p>
            </div>
            <div class="content">
              <h2>Hello ${name},</h2>
              <p>We received a request to reset your Flourishing Hub password. Click the button below to set a new password:</p>
              <div style="text-align: center;">
                <a href="${resetLink}" class="button">Reset My Password</a>
              </div>
              <div class="warning">
                <strong>This link expires in 15 minutes.</strong><br>
                If you did not request a password reset, please ignore this email — your account is safe.
              </div>
              <p>If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="word-break: break-all; font-size: 12px; color: #666;">${resetLink}</p>
              <p>Best regards,<br>Flourishing Hub Team<br>IIT Bombay</p>
            </div>
            <div class="footer">
              <p>This is an automated email. Please do not reply to this message.</p>
              <p>&copy; ${new Date().getFullYear()} Flourishing Hub, IIT Bombay. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };
    const info = await transporter.sendMail(mailOptions);
    console.log(`Password reset email accepted by SMTP server for ${email}: messageId=${info.messageId} response="${info.response}"`);
    return true;
  } catch (error) {
    console.error("Error sending password reset email:", error);
    return false;
  }
};

// Send pending approval notification email
export const sendPendingApprovalEmail = async (email, name) => {
  try {
    const transporter = createTransporter();
    
    if (!transporter) {
      console.log(`Pending approval email skipped for ${email} (email not configured)`);
      return true;
    }

    const mailOptions = {
      from: `"Flourishing Hub, IIT Bombay" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Registration Received - Approval Pending",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border-radius: 0 0 10px 10px; }
            .tagline { font-style: italic; color: white; margin-top: 10px; }
            .info-box { background: #f0f7ff; border-left: 4px solid #667eea; padding: 15px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Registration Received</h1>
              <p>IIT Bombay</p>
              <p class="tagline">Let's Thrive, Not Just Survive</p>
            </div>
            <div class="content">
              <h2>Hello ${name},</h2>
              <p>Thank you for registering with Flourishing Hub!</p>

              <div class="info-box">
                <p><strong>Your registration is currently under review by our admin team.</strong></p>
              </div>
              
              <p>Here's what happens next:</p>
              <ol>
                <li>Our admin team will review your registration details</li>
                <li>You will receive an email notification once your account is approved</li>
                <li>After approval, you can login and access all features</li>
              </ol>
              
              <p><strong>Timeline:</strong> This process typically takes 24-48 hours.</p>
              
              <p>If you have any questions, please contact the Flourishing Hub team at IIT Bombay.</p>
              
              <p>Best regards,<br>Flourishing Hub Team<br>IIT Bombay</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Error sending pending approval email:", error);
    return false;
  }
};
