const emailVerificationToken = require('../models/emailVerificationToken');
const User = require('../models/user');
const jwt = require('jsonwebtoken');
const { isValidObjectId } = require('mongoose');
const { generateOTP, generateMailTransporter } = require('../utils/mail');
const { sendError, generateRandomByte } = require('../utils/helper');
const PasswordResetToken = require('../models/passwordResetToken');

exports.create = async (req, res) => {
  const { name, email, password } = req.body;

  const oldUser = await User.findOne({ email });
  if (oldUser) return sendError(res, 'This email is already in use');

  const newUser = new User({ name, email, password });
  await newUser.save();

  // Send email verification token
  let OTP = generateOTP();

  const newEmailValidationToken = new emailVerificationToken({
    owner: newUser._id,
    token: OTP,
  });
  await newEmailValidationToken.save();

  const transport = generateMailTransporter();

  transport.sendMail({
    from: 'verification@reviewapp.com',
    to: newUser.email,
    subject: 'Email Verification',
    html: `
      <p>Your verification OTP</p>
      <h1>${OTP}</h1>
    `,
  });

  res.status(201).json({
    user: {
      id: newUser._id,
      name: newUser.name,
      email: newUser.email,
    },
  });
};

exports.verifyEmail = async (req, res) => {
  const { userId, OTP } = req.body;

  if (!isValidObjectId(userId)) return sendError(res, 'Invalid user');

  const user = await User.findById(userId);
  if (!user) return sendError(res, 'User not found', 404);

  if (user.isVerified) return sendError(res, 'User already verified');

  const token = await emailVerificationToken.findOne({ owner: userId });
  if (!token) return sendError(res, 'Token not found', 404);

  const isMatched = await token.compareToken(OTP);
  if (!isMatched) return sendError(res, 'OTP not matched');

  user.isVerified = true;
  await user.save();

  await emailVerificationToken.findByIdAndDelete(token._id);

  const transport = generateMailTransporter();

  transport.sendMail({
    from: 'verification@reviewapp.com',
    to: user.email,
    subject: 'Welcome Email',
    html: `
      <h1>Welcome to our app and thanks for choosing us.</h1>
    `,
  });

  const jwtToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);

  res.json({
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      token: jwtToken,
      isVerified: user.isVerified,
    },
    message: 'Your email has been verified!',
  });
};

exports.resendEmailVerificationToken = async (req, res) => {
  const { userId } = req.body;

  if (!isValidObjectId(userId)) return sendError(res, 'Invalid user');

  const user = await User.findById(userId);
  if (!user) return sendError(res, 'User not found', 404);

  if (user.isVerified) return sendError(res, 'User already verified');

  const alreadyHasToken = await emailVerificationToken.findOne({
    owner: userId,
  });
  if (alreadyHasToken)
    return sendError(
      res,
      'Only after one hour you can request for another token!'
    );

  // resend email verification token
  let OTP = generateOTP();

  const newEmailValidationToken = new emailVerificationToken({
    owner: user._id,
    token: OTP,
  });
  await newEmailValidationToken.save();

  const transport = generateMailTransporter();

  transport.sendMail({
    from: 'verification@reviewapp.com',
    to: user.email,
    subject: 'Email Verification',
    html: `
      <p>Your verification OTP</p>
      <h1>${OTP}</h1>
    `,
  });

  res.json({
    message: 'New OTP has been sent to your email account!',
  });
};

exports.forgetPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return sendError(res, 'Email is required');

  const user = await User.findOne({ email });
  if (!user) return sendError(res, 'User not found', 404);

  const alreadyHasToken = await PasswordResetToken.findOne({ owner: user._id });
  if (alreadyHasToken)
    return sendError(
      res,
      'Only after one hour you can request for another token!'
    );

  const token = await generateRandomByte();

  const newPasswordResetToken = await PasswordResetToken({
    owner: user._id,
    token,
  });
  await newPasswordResetToken.save();

  const resetPasswordUrl = `http://localhost:3000/auth/reset-password?token=${token}&id=${user._id}`;

  const transport = generateMailTransporter();

  transport.sendMail({
    from: 'security@reviewapp.com',
    to: user.email,
    subject: 'Reset Password Link',
    html: `
      <p>Click here to reset password</p>
      <a href="${resetPasswordUrl}" >Change Password</a>
    `,
  });

  res.json({
    message: 'Reset password link has been sent to your email account!',
  });
};

exports.sendResetPasswordTokenStatus = (req, res) => {
  res.json({ valid: true });
};

exports.resetPassword = async (req, res) => {
  const { newPassword, userId } = req.body;

  const user = await User.findById(userId);
  const matched = await user.comparePassword(newPassword);
  if (matched)
    return sendError(
      res,
      'The new password must be different from the old one'
    );

  user.password = newPassword;
  await user.save();

  await PasswordResetToken.findOneAndDelete(req.resetToken._id);

  const transport = generateMailTransporter();

  transport.sendMail({
    from: 'security@reviewapp.com',
    to: user.email,
    subject: 'Password Reset Successfully',
    html: `
      <h1>Password Reset Successfully!</h1>
      <p>Now you can use new password.</p>
    `,
  });

  res.json({ message: 'Password has been reset successfully!' });
};

exports.singIn = async (req, res, next) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) return sendError(res, 'Email/Password mismatch');

  const matched = await user.comparePassword(password);
  if (!matched) return sendError(res, 'Email/Password mismatch');

  const { _id, name, isVerified } = user;
  const jwtToken = jwt.sign({ userId: _id }, process.env.JWT_SECRET);

  res.json({
    user: { id: _id, name, email, token: jwtToken, isVerified },
  });
};
