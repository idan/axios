'use strict';

var defaults = require('./../defaults');
var utils = require('./../utils');
var buildURL = require('./../helpers/buildURL');
var transformData = require('./../helpers/transformData');
var http = require('follow-redirects').http;
var https = require('follow-redirects').https;
var url = require('url');
var zlib = require('zlib');
var pkg = require('./../../package.json');
var Buffer = require('buffer').Buffer;

module.exports = function httpAdapter(resolve, reject, config) {
  // Transform request data
  var data = transformData(
    config.data,
    config.headers,
    config.transformRequest
  );

  // Merge headers
  var headers = utils.merge(
    defaults.headers.common,
    defaults.headers[config.method] || {},
    config.headers || {}
  );

  // Set User-Agent (required by some servers)
  // Only set header if it hasn't been set in config
  // See https://github.com/mzabriskie/axios/issues/69
  if (!headers['User-Agent'] && !headers['user-agent']) {
    headers['User-Agent'] = 'axios/' + pkg.version;
  }

  if (data) {
    if (utils.isArrayBuffer(data)) {
      data = new Buffer(new Uint8Array(data));
    } else if (utils.isString(data)) {
      data = new Buffer(data, 'utf-8');
    } else {
      return reject(new Error('Data after transformation must be a string or an ArrayBuffer'));
    }

    // Add Content-Length header if data exists
    headers['Content-Length'] = data.length;
  }

  // Parse url
  var parsed = url.parse(config.url);
  var options = {
    host: parsed.hostname,
    port: parsed.port,
    path: buildURL(parsed.path, config.params, config.paramsSerializer).replace(/^\?/, ''),
    method: config.method,
    headers: headers,
    agent: config.agent
  };

  // Create the request
  var transport = parsed.protocol === 'https:' ? https : http;
  var req = transport.request(options, function (res) {

    // uncompress the response body transparently if required
    var stream = res;
    switch(res.headers['content-encoding']) {
      case 'gzip':
      case 'compress':
      case 'deflate': {
        // add the unzipper to the body stream processing pipeline
        stream = stream.pipe(zlib.createUnzip());

        // remove the content-encoding in order to not confuse downstream operations
        delete res.headers['content-encoding'];
      }
    }

    var responseBuffer = [];
    stream.on('data', function (chunk) {
      responseBuffer.push(chunk);
    });

    stream.on('end', function () {
      var data = Buffer.concat(responseBuffer);
      if (config.responseType !== 'arraybuffer') {
        data = data.toString('utf8');
      }
      var response = {
        data: transformData(
          data,
          res.headers,
          config.transformResponse
        ),
        status: res.statusCode,
        statusText: res.statusMessage,
        headers: res.headers,
        config: config
      };

      // Resolve or reject the Promise based on the status
      (res.statusCode >= 200 && res.statusCode < 300 ?
        resolve :
        reject)(response);
    });
  });

  // Handle errors
  req.on('error', function (err) {
    reject(err);
  });

  // Handle request timeout
  req.setTimeout(config.timeout, function () {
    req.abort();
  });

  // Send the request
  req.end(data);
};
