import env from './env.js';
import express from 'express';
import bodyParser from 'body-parser';
import passport from 'passport';
import session from'express-session';
import apiRoute from './../../../routes/api.js';
import webRoute from './../../../routes/web.js';
import { Model } from 'objection';
import { DB } from '@averoa/utilities';
import cors from './cors.js';
import morgan from './morgan.js';
import edge, {engine} from './edge-js.js';
import path from 'path';
import test from './test.js'
import { AppProvider, ViewProvider } from '@averoa/providers';
import * as Strategies from './../../../app/Strategies/index.js';
import csrf from 'csurf';
import cookieParser from 'cookie-parser';

const app = express()
const port = process.env.APP_PORT;
const __dirname = path.resolve();
const csrfProtection = csrf({ cookie: true })

export const start = async () => {
  AppProvider.beginning(app)
  test.met(app)
  
  morgan(app);
  
  app.use(cors)

  app.use(session({
    secret: "secret",
    resave: false ,
    saveUninitialized: true ,
  }))

  app.use(passport.initialize())
  app.use(passport.session())

  for(let strategy in Strategies) {
    Strategies[strategy].config()
  }
  
  Model.knex(DB);
  
  app.use(engine);
  app.set('views', path.join(__dirname, '/resources/views'));
  
  for(let ii in ViewProvider.global()) {
    edge.global(ii, ViewProvider.global()[ii])
  }

  app.use("/public", express.static(path.join(__dirname, '/public')));
  
  app.use(bodyParser.json())
  app.use(bodyParser.urlencoded({ extended: true }))
  app.use(cookieParser())
  
  app.use('/api', apiRoute)
  app.use('/', csrfProtection, webRoute)

  AppProvider.end(app)

  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
  })
}

export { default as env } from './env.js'
export { default as edge } from './edge-js.js'
export { default as command } from './command.js'