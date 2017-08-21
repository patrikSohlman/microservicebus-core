﻿/*
The MIT License (MIT)

Copyright (c) 2014 microServiceBus.com

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
'use strict';
var crypto = require('crypto');
var httpRequest = require('request');
var storage = require('node-persist');
var util = require('./utils.js');
var extend = require('extend');
var moment = require('moment');
var storageIsEnabled = true;

function Com(nodeName, sbSettings, hubUri, settingsHelper) {
    var me = this;
    try {
        storage.initSync(); // Used for persistent storage if off-line
    }
    catch (storageEx) {
        console.log("Local persistance is not allowed");
        storageIsEnabled = false;
    }
    sbSettings.sbNamespace = sbSettings.sbNamespace + '.servicebus.windows.net';

    this.currentState = {
        desired: {},
        reported: {}
    };
    this.settingsHelper = settingsHelper;
    this.onStateReceivedCallback = null;
    this.onQueueMessageReceivedCallback = null;
    this.onQueueErrorReceiveCallback = null;
    this.onQueueErrorSubmitCallback = null;
    this.onQueueDebugCallback = null;
    this.onActionCallback = null;

    Com.prototype.OnStateReceivedCallback = function (callback) {
        this.onStateReceivedCallback = callback;
    };
    Com.prototype.OnQueueMessageReceived = function (callback) {
        this.onQueueMessageReceivedCallback = callback;
    };
    Com.prototype.OnReceivedQueueError = function (callback) {
        this.onQueueErrorReceiveCallback = callback;
    };
    Com.prototype.OnSubmitQueueError = function (callback) {
        this.onQueueErrorSubmitCallback = callback;
    };
    Com.prototype.OnQueueDebugCallback = function (callback) {
        this.onQueueDebugCallback = callback;
    };
    Com.prototype.OnActionCallback = function (callback) {
        this.onActionCallback = callback;
    };
    Com.prototype.Start = function () {
    };
    Com.prototype.Stop = function () {
    };
    Com.prototype.Submit = function (message, node, service) {
    };
    Com.prototype.SubmitEvent = function (message) {
    };
    Com.prototype.ChangeState = function (state, node) {
        console.log("Com::ChangeState - NOT IMPLEMENTED FOR IOT PROVIDER!");
    };
    Com.prototype.Track = function (trackingMessage) {
    };
    Com.prototype.Update = function (settings) {
    };

    var Protocol = require('./protocols/' + sbSettings.protocol + '.js');
    var protocol = new Protocol(nodeName, sbSettings);
    protocol.hubUri = hubUri;

    extend(this, protocol);
}
module.exports = Com;