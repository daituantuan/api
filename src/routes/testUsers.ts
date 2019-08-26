import * as express from "express";

const router = express.Router();

router.post("/", (req, res) => {
  const username = req.body.username;
  const password = req.body.password;
  if (username && password) {
    return res.status(201).send("success");
  } else {
    return res.status(422).send("incomplete information");
  }
});

export default router;
