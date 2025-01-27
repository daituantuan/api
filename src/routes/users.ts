import bcrypt from "bcrypt";
import express from "express";
import jwt from "jsonwebtoken";
import secret from "../configs/secret";
import authenticate from "../middlewares/authenticate";
import checkToken from "../middlewares/checkToken";
import User from "../models/user";
import pick from "lodash.pick";
import { sendEmail } from "../helpers";
import { resetPasswordTemplate } from "../helpers/htmlTemplates";

const router = express.Router();

/**
 * GET users with queries
 * @param {string} username
 * @param {string} department
 * @param {string} class
 * @param {number} begin
 * @param {number} end
 * @param {boolean} detailInfo
 * @param {boolean} isTeacher
 * @returns certain users
 */
router.get("/", authenticate([]), async (req, res, next) => {
  const query = {
    ...pick(req.query, ["username", "department", "class"]),
    ...(req.query.isTeacher && { group: "teacher" })
  };

  let select = "-_id -__v -password";
  const begin = parseInt(req.query.begin, 10) || 0;
  const end = parseInt(req.query.end, 10) || Number.MAX_SAFE_INTEGER;
  const role = req.auth.role || "";
  if (
    role !== "root" ||
    !req.query.detailInfo ||
    req.query.detailInfo.toString() === "false"
  ) {
    select = select + " -group -role -username";
  }

  try {
    const users = await User.find(query, select, {
      skip: begin,
      limit: end - begin + 1,
      sort: "-createdAt"
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

/**
 * GET user of Id
 * @param {number} id
 * @param {boolean} detailInfo
 * @returns {Object} user with id
 */
router.get("/:id", checkToken, async (req, res, next) => {
  let select = "-_id -__v -password";
  let hasDetailInfo = false;
  if (
    req.auth.tokenValid &&
    req.query.detailInfo &&
    req.query.detailInfo.toString() === "true"
  ) {
    if (
      (req.auth.id && req.auth.id.toString() === req.params.id) ||
      req.auth.role === "root"
    ) {
      hasDetailInfo = true;
    }
  }
  if (!hasDetailInfo) {
    select = select + " -group -role -email -phone -class";
  }

  try {
    const user = await User.findOne({ id: req.params.id }, select);

    if (!user) {
      return res.status(404).send("404 Not Found: User does not exist");
    }

    res.json(user);
  } catch (err) {
    next(err);
  }
});

/**
 * POST new user
 * @returns Location header
 */
router.post("/", async (req, res, next) => {
  const password = req.body.password;
  if (!password) {
    return res.status(422).send("422 Unprocessable Entity: Missing form data");
  }

  try {
    const saltRounds = 10;
    const hash = await bcrypt.hash(password, saltRounds);

    const user = await new User({
      group: "student",
      role: "student",
      ...req.body,
      password: hash
    }).save();

    res.setHeader("Location", "/v1/users/" + user.id);
    res.status(201).end();
  } catch (err) {
    next(err);
  }
});

/**
 * POST login form
 * @returns {string} token
 */
router.post("/login", async (req, res, next) => {
  const id = req.body.id;
  const username = req.body.username;
  const email = req.body.email;
  const password = req.body.password;
  if (!((id || username || email) && password)) {
    return res
      .status(422)
      .send("422 Unprocessable Entity: Missing credentials");
  }

  try {
    let user = await User.findOne({ username });

    if (!user) {
      user = await User.findOne({ email });
    }

    if (!user) {
      return res.status(404).send("404 Not Found: User does not exist");
    }

    const valid = await bcrypt.compare(password, user.password);
    if (valid) {
      const token = jwt.sign(
        {
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
          phone: user.phone,
          group: user.group,
          role: user.role,
          "https://hasura.io/jwt/claims": {
            "x-hasura-allowed-roles": [
              "student",
              "counselor",
              "teacher",
              "root"
            ],
            "x-hasura-default-role": user.role,
            "x-hasura-user-id": user.id.toString()
          }
        },
        secret,
        {
          expiresIn: "12h"
        }
      );
      res.json({ token });
    } else {
      res.status(401).end();
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST reset password
 * @returns No Content or Not Found
 */
router.post("/reset", async (req, res, next) => {
  try {
    const query = pick(req.body, ["username", "id", "email"]);
    if (!(query.id || query.username || query.email) || !req.body.action) {
      return res
        .status(422)
        .send("422 Unprocessable Entity: Missing essential information");
    }

    const user = await User.findOne(query);

    if (!user) {
      return res.status(404).send("404 Not Found: User does not exist");
    }
    if (!user.email) {
      return res.status(404).send("404 Not Found: User does not have an email");
    }

    if (req.body.action === "get") {
      const token = jwt.sign({ ...query, action: "reset" }, secret, {
        expiresIn: "15m"
      });

      await sendEmail(
        user.email,
        "重置您的密码",
        resetPasswordTemplate(user.name, "https://eesast.com/reset/" + token)
      );

      res.status(201).end();
    }
    if (req.body.action === "set") {
      if (!req.body.password) {
        return res
          .status(422)
          .send("422 Unprocessable Entity: Missing essential information");
      }

      const saltRounds = 10;
      const hash = await bcrypt.hash(req.body.password, saltRounds);

      await user.updateOne({
        password: hash,
        updatedAt: new Date()
      });

      res.status(204).end();
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST check token for resetting password
 * @returns 200 or 401
 */
router.get("/reset/:token", (req, res) => {
  try {
    const decoded = jwt.verify(req.params.token, secret) as any;

    if (decoded.action === "reset") {
      res.status(200).end();
    } else {
      res.status(401).send("401 Unauthorized: Wrong token");
    }
  } catch (err) {
    res.status(401).send("401 Unauthorized: Wrong token");
  }
});

/**
 * PUT existing user
 * @param {number} id - updating user's id
 * @returns Location header or Not Found
 */
router.put("/:id", authenticate(["root", "self"]), async (req, res, next) => {
  if (req.auth.selfCheckRequired) {
    if (parseFloat(req.params.id) !== req.auth.id) {
      return res.status(401).send("401 Unauthorized: Permission denied");
    }
  }

  if (req.auth.role !== "root") {
    delete req.body.group;
    delete req.body.role;
  }

  let password;
  if (req.body.password) {
    const saltRounds = 10;
    password = await bcrypt.hash(req.body.password, saltRounds);
  }

  try {
    const update = {
      ...req.body,
      ...(password && { password }),
      updatedAt: new Date(),
      updatedBy: req.auth.id
    };
    const user = await User.findOneAndUpdate({ id: req.params.id }, update);

    if (!user) {
      return res.status(404).send("404 Not Found: User does not exist");
    }

    res.setHeader("Location", "/v1/users/" + user.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE a user of Id
 * @param {number} id - deleting user's id
 * @returns No Content or Not Found
 */
router.delete("/:id", authenticate(["root"]), async (req, res, next) => {
  try {
    const deleteUser = await User.findOneAndDelete({
      id: req.params.id
    });

    if (!deleteUser) {
      return res.status(404).send("404 Not Found: User does not exist");
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
