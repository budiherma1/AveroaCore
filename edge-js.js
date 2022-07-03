'use strict';

import {Edge} from 'edge.js';
import path from 'path';
let edge = new Edge({cache: false});
const __dirname = path.resolve();

export var engine = function engine(req, res, next) {
  /*
  |-------------------------------------------------------------------------------------------------
  | Override the app.render function so that we can use dot notation
  |-------------------------------------------------------------------------------------------------
  */

  var render = res.render;


  res.render = function _render(view, options, callback) {
    var self = this;

    render.call(self, view.replace(/\./gi, '/'), options, callback);
  };

  /*
  |-------------------------------------------------------------------------------------------------
  | Register the edge view engine
  |-------------------------------------------------------------------------------------------------
  */

  req.app.engine('edge', function (filePath, options, callback) {
    edge.mount(req.app.settings.views);

    edge.render(filePath, options).then(function (content) {
      return callback(null, content);
    }).catch(function (err) {
      return callback(err);
    });
  });

  /*
  |-------------------------------------------------------------------------------------------------
  | Set the app view engine
  |-------------------------------------------------------------------------------------------------
  */

  req.app.set('view engine', 'edge');

  next();
};

edge.mount(path.join(__dirname, '/resources/views'))

export default edge