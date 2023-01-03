import { shared, env } from "@appblocks/node-sdk";
import joi from "joi";
import { createTransport } from "nodemailer";
import { hashSync } from "bcrypt";

env.init();
async function sendMail({ emailTo, subject, Text, html }) {
  try {
    const mailer = process.env.shield_mailer_email;
    const password = process.env.SAMPLE_SHIELD_SIGNUP_FN_SHIELD_MAILER_PASSWORD;
    const host = process.env.SAMPLE_SHIELD_SIGNUP_FN_SHIELD_MAILER_HOST;
    const port = process.env.SAMPLE_SHIELD_SIGNUP_FN_SHIELD_MAILER_PORT;

    let transporter = createTransport({
      host,
      port,
      secure: port === 465, // true for 465, false for other ports
      auth: { user: mailer, pass: password },
    });

    let info = await transporter.sendMail({
      from: mailer,
      to: emailTo,
      subject,
      text: Text,
      html,
    });

    if (!info) return new Error("Email not sent");
    return info;
  } catch (error) {
    return error;
  }
}
const generateOTP = () => {
  const email_verification_code = String(
    Math.floor(100000 + Math.random() * 900000)
  );
  const email_verification_expiry = new Date();
  email_verification_expiry.setMinutes(
    email_verification_expiry.getMinutes() +
      process.env.email_verification_expiry || 10
  );
  return { email_verification_code, email_verification_expiry };
};

function sendEmailVerificationCode({ email, email_verification_code }) {
  return sendMail({
    emailTo: email,
    Subject: "verification code for your account",
    Text: email_verification_code,
    Html: email_verification_code,
  });
}

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

  // Add your code here
  try {
    let userProviderUpdate;

    const body = await getBody(req);
    const { value, error } = schema.validate(body);

    if (error) {
      const _d = {
        err: true,
        msg: error.details[0].message,
        data: { errors: [...error.details] },
      };
      sendResponse(res, 400, _d);
      return;
    }

    const { email, password, provider_source, acceptTerms, username } = value;

    const userData = await prisma.users.findFirst({ where: { email } });
    console.log("USERDATA:", userData);
    if (userData) {
      let userproviderdata = await prisma.user_providers.findFirst({
        where: { user_id: userData.id },
      });
      console.log("USERPROVIDERDATA:", userproviderdata);
      if (!userproviderdata) userproviderdata = {};
      if (userproviderdata.provider_id === providerIdsMap[provider_source]) {
        sendResponse(res, 303, {
          err: true,
          msg: "Already SignedUp, please login!",
          data: {
            user_name: userData.user_name,
            email: userData.email,
          },
        });
        return;
      }

      userProviderUpdate = {
        where: { user_id: userData.id },
        data: {
          provider_id: providerIdsMap[provider_source],
        },
      };
    }
    const { email_verification_code, email_verification_expiry } =
      generateOTP();
    const userDataPayload = await prisma.users.create({
      data: {
        email,
        password: hashSync(password, 10),
        email_verified: false,
        email_verification_code,
        email_verification_expiry,
        user_id: username, //
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

    console.log("USERDATAPAYLOAD&&&&&&:", userDataPayload);
    if (!userProviderUpdate)
      userProviderUpdate = {
        data: {
          user_id: userDataPayload.user_id,
          provider_id: providerIdsMap[provider_source],
        },
      };
    const userProviderPayload = await prisma.user_providers.create(
      userProviderUpdate
    );

    if (!(await sendEmailVerificationCode(email, email_verification_code))) {
      sendResponse(res, 500, { err: true, msg: "server error", data: {} });
      return;
    }

    sendResponse(res, 302, {
      err: false,
      msg: "otp successfully generated and send",
      data: {},
    });
  } catch (error) {
    console.log(error);
    sendResponse(res, 200, { err: true, msg: error.message, data: {} });
    return;
  }
};

export default sample_shield_signup_fn;
