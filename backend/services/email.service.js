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
  
  return nodemailer.createTransporter({
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
              <h1>🎉 Welcome to Flourishing Hub!</h1>
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
              <h1>🎉 Account Approved!</h1>
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
