'use strict';

const { createAppServer } = require('../server.js');
module.exports = createAppServer().listeners('request')[0];
