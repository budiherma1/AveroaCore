import env from './env.js';
import express from 'express';
import bodyParser from 'body-parser';
import passport from 'passport';
import apiRoute from './../../../routes/api.js';
import webRoute from './../../../routes/web.js';
import { Model } from 'objection';
import { DB } from '@averoa/utilities';
import cors from './cors.js';
import morgan from './morgan.js';
import edge, {engine} from './edge-js.js';
import path from 'path';
import passportConfig from './../../../config/passport.js';
import test from './test.js'
import { AppProvider, ViewProvider } from '@averoa/providers';
const app = express()
const port = process.env.APP_PORT;
const __dirname = path.resolve();
// import nodemailer from 'nodemailer';

export const start = async () => {
  AppProvider.beginning(app)
  test.met(app)
  morgan(app);
  
  app.use(cors)
  app.use(passport.initialize())
  
  passportConfig();
  Model.knex(DB);
  
  app.use(engine);
  app.set('views', path.join(__dirname, '/resources/views'));
  ViewProvider.inject(edge)

  app.use("/public", express.static(path.join(__dirname, '/public')));
  
  app.use(bodyParser.json())
  app.use(bodyParser.urlencoded({ extended: true }))
  
  app.use('/api', apiRoute)
  app.use('/', webRoute)

  AppProvider.end(app)
  // 
//reference the plugin
// console.log('testtttt')
//attach the plugin to the nodemailer transporter
// let transporter = nodemailer.createTransport({
//   host: process.env.MAIL_HOST,
//   port: process.env.MAIL_PORT,
//   secure: false, // true for 465, false for other ports
//   auth: {
//     user: process.env.MAIL_USERNAME, // generated ethereal user
//     pass: process.env.MAIL_PASSWORD, // generated ethereal password
//   },
// });


// const html = await edge.render('home', {
//   greeting: 'Hello world'
// })

// let eemail = await transporter.sendMail({
//   from: '"Fred Foo 👻" <foo@example.com>', // sender address
//   to: "bar@example.com, baz@example.com", // list of receivers
//   subject: "tesrHello ✔", // Subject line
//   text: "tesrHello world?", // plain text body
//   html: html, // html body
// });
// transporter.sendMail(eemail);
  // 
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
  })
}

export { default as env } from './env.js'
export { default as edge } from './edge-js.js'