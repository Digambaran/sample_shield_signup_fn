import { shared, env } from "@appblocks/node-sdk";
import joi from "joi";
import { createTransport } from "nodemailer";
import { hashSync } from "bcrypt";

env.init();

async function sendMail({ to, subject, text, html }) {
  const from = process.env.SAMPLE_SHIELD_SIGNUP_FN_SHIELD_MAILER_EMAIL;
  const password = process.env.SAMPLE_SHIELD_SIGNUP_FN_SHIELD_MAILER_PASSWORD;
  const host = process.env.SAMPLE_SHIELD_SIGNUP_FN_SHIELD_MAILER_HOST;
  const port = process.env.SAMPLE_SHIELD_SIGNUP_FN_SHIELD_MAILER_PORT;

  const transporter = createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for other ports
    auth: { user: from, pass: password },
  });

  console.log(`to:${to}`);
  console.log(`from:${from}`);
  console.log(`html:${html}`);
  console.log(`text:${text}`);
  console.log(`subject:${subject}`);

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });

  console.log("info");
  console.log(info);
  if (!info) throw new Error("Email not sent");
  return info;
}

/**
 *
 * @returns {{email_verification_code:string,email_verification_expiry:timestamp}}
 */
const generateOTP = () => {
  const expiry =
    process.env.SAMPLE_SHIELD_SIGNUP_FN_EMAIL_VERIFICATION_EXPIRY || 10;
  console.log(`verification code expiry ${expiry} minutes`);
  const email_verification_code = String(
    Math.floor(100000 + Math.random() * 900000)
  );
  const currentTime = new Date();
  const email_verification_expiry = new Date(
    currentTime.getTime() + expiry * 60 * 1000
  );
  return { email_verification_code, email_verification_expiry };
};

/**
 *
 * @param {*} req
 * @param {*} res
 * @returns
 */
const sample_shield_signup_fn = async (req, res) => {
  const schema = joi.object({
    email: joi.string().email().required(),
    password: joi
      .string()
      .pattern(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[`!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~])[A-Za-z0-9`!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~]{8,}$/
      ),
    username: joi.string().required(),
    provider_source: joi.string().required(),
    acceptTerms: joi.boolean().required(),
  });

  const providerIdsMap = {
    google: "",
    linkedin: "",
    twitter: "",
    shield: "4",
  };

  const { prisma, getBody, sendResponse } = await shared.getShared();
  // health check
  if (req.params["health"] === "health") {
    sendResponse(res, 200, { success: true, msg: "Health check success" });
    return;
  }

  try {
    const body = await getBody(req);
    const { value: validatedValues, error } = schema.validate(body);

    if (error) {
      sendResponse(res, 400, {
        err: true,
        msg: error.details[0].message,
        data: { errors: [...error.details] },
      });
      return;
    }

    const { email, password, provider_source, acceptTerms, username } =
      validatedValues;

    console.log("form data received and validated");
    console.log(`email:${email}`);
    console.log(`password satisfies constraints`);
    console.log(`provider_source:${provider_source}`);
    console.log(`acceptTerms:${acceptTerms}`);
    console.log(`username:${username}`);

    const userData = await prisma.users.findFirst({ where: { email } });
    const userAlreadyExists = !!userData;
    if (!userAlreadyExists) {
      const { email_verification_code, email_verification_expiry } =
        generateOTP();

      await prisma.$transaction(async (tx) => {
        const userDataPayload = await tx.users.create({
          data: {
            email,
            password: hashSync(password, 10),
            email_verified: false,
            email_verification_code,
            email_verification_expiry,
            user_id: username,
            user_name: username,
            full_name: "",
            address1: "",
            address2: "",
            phone: "",
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: new Date(),
            opt_counter: 1,
          },
        });

        await tx.user_providers.create({
          data: {
            user_id: userDataPayload.user_id,
            provider_id: providerIdsMap[provider_source],
          },
        });

        await sendMail({
          to: email,
          subject: "verification code for your account",
          text: email_verification_code,
          html: email_verification_code,
        });
      });
      console.log(`OTP sent to ${email} successfully `);

      sendResponse(res, 302, {
        err: false,
        msg: "otp successfully generated and send",
        data: {},
      });
      return;
    }
    // Email already exists in records
    console.log(`User with email:${email} exists in records`);

    const userproviderdata = await prisma.user_providers.findFirst({
      where: { user_id: userData.id },
    });

    if (userproviderdata?.provider_id === providerIdsMap[provider_source]) {
      console.log(`User provider record for id:${userData.id} exists`);
      console.log(`User already signed up with provider`);
      sendResponse(res, 303, {
        err: true,
        msg: "Already SignedUp, please login!",
        data: {
          user_name: userData.user_name,
          email: userData.email,
        },
      });
      console.log("returned with 303");
      return;
    }

    await prisma.user_providers.create({
      data: {
        user_id: userDataPayload.user_id,
        provider_id: providerIdsMap[provider_source],
      },
    });
  } catch (error) {
    console.log(error);
    sendResponse(res, 500, { err: true, msg: "server error", data: {} });
    return;
  }
};

export default sample_shield_signup_fn;
