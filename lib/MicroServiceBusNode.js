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

var moment = require('moment');
var extend = require('extend');
var async = require('async');
var reload = require('require-reload')(require);
var os = require("os");
var fs = require('fs');
var path = require('path');
var guid = require('uuid');
var pjson = require('../package.json');
var Applicationinsights = require("./Applicationinsights.js");
var util = require('./utils.js');
var MicroService = require('./services/microService.js');
var Com = require("./Com.js");

function MicroServiceBusNode(settingsHelper) {
    var self = this;
    this.settingsHelper = settingsHelper;
    // Callbacks
    this.onStarted = null;
    this.onStopped = null;
    this.onSignedIn = null;
    this.onPingResponse = null;
    this.onUpdatedItineraryComplete = null;
    this.onLog = null;
    this.onAction = null;
    this.onCreateNode = null;
    this.onCreateNodeFromMacAddress = null;
    this.onReportLocation = null;
    // Handle settings
    var hostPrefix = 'node'; // Used for creating new hosts
    var _itineraries; // all downloaded itineries for this host
    var _inboundServices = []; // all started services
    var _hasDisconnected = false;
    var _shoutDown = false;
    var _downloadedScripts = [];
    var _firstStart = true;
    var _loadingState = "none"; // node -> loading -> done -> stopped
    var _restoreTimeout;
    var _comSettings;
    var signInResponse;
    var com;
    var checkConnectionInterval;
    var loadedItineraries = 0;
    var exceptionsLoadingItineraries = 0;
    var _startWebServer = false;
    var port = process.env.PORT || 1337;
    var baseHost = process.env.WEBSITE_HOSTNAME || 'localhost';
    var app;// = express();
    var server;
    var rootFolder = process.arch == 'mipsel' ? '/mnt/sda1' : __dirname;
    var applicationinsights = new Applicationinsights();
    var auth;
    var http;
    var express;
    var swaggerize;
    var bodyParser;
    var memwatch;
    var logStream;
    this.nodeVersion;

    // Called by HUB if it was ot able to process the request
    MicroServiceBusNode.prototype.ErrorMessage = function (message) {
        self.onLog("errorMessage => " + message);
        self.onStarted(0, 1);
    };
    // Called by HUB to receive all active serices
    MicroServiceBusNode.prototype.GetEndpoints = function (message) {
        self.onLog("getEndpoints => " + message);
    }
    // Called by HUB when itineraries has been updated
    MicroServiceBusNode.prototype.UpdateItinerary = function (updatedItinerary) {
        self.onLog();
        self.onLog("Updating flows".green);
        self.onLog();
        // Stop all services
        stopAllServices(function () {
            self.onLog("All services stopped".yellow);
        });


        var itinerary = _itineraries.find(function (i) {
            return i.itineraryId === updatedItinerary.itineraryId;
        });
        //var itinerary = new linq(_itineraries).First(function (i) { return i.itineraryId === updatedItinerary.itineraryId; });

        for (var i = _itineraries.length; i--;) {
            if (_itineraries[i].itineraryId === updatedItinerary.itineraryId) {
                _itineraries.splice(i, 1);
            }
        }
        _itineraries.push(updatedItinerary);

        //loadItineraries(settings.organizationId, _itineraries);
        startAllServices(_itineraries, function () {
            _restoreTimeout = setTimeout(function () {
                restorePersistedMessages();
            }, 3000);
        });
    }
    // Called by HUB when itineraries has been updated
    MicroServiceBusNode.prototype.ChangeState = function (state) {

        self.onLog();
        //_isWaitingForSignInResponse = false;
        settingsHelper.settings.state = state;
        if (state == "Active") {
            self.onLog("State:".white + state.green);
            self.onLog();
        }
        else {
            self.onLog("State:".white + state.yellow);
            self.onLog();
        }

        if (state != "Active") {
            stopAllServices(function () {
                self.onLog("All services stopped".yellow);
            });
        }
        else {
            _downloadedScripts = [];
            _inboundServices = [];
            startAllServices(_itineraries, function () {

            });
        }
    }
    // Called by HUB to enable or disable tracking
    MicroServiceBusNode.prototype.SetTracking = function (enableTracking) {

        settingsHelper.settings.enableTracking = enableTracking;
        if (enableTracking)
            self.onLog("Tracking: ".white + "enabled".green);
        else
            self.onLog("Tracking: ".white + "disabled".yellow);

    }
    // Update debug mode
    MicroServiceBusNode.prototype.ChangeDebug = function (debug) {
        self.onLog("Debug: ".white + debug);
        settingsHelper.settings.debug = debug;

    }
    // Incoming message from HUB
    MicroServiceBusNode.prototype.SendMessage = function (message, destination) {
        //receiveMessage(message, destination);
    }
    // Called by HUB when signin  has been successful
    MicroServiceBusNode.prototype.SignInComplete = function (response) {
        //_isWaitingForSignInResponse = false;

        if (response.sas != undefined) {
            settingsHelper.settings.sas = response.sas;
            settingsHelper.settings.debug = undefined;
            settingsHelper.settings.state = undefined;
            settingsHelper.settings.port = undefined;
            settingsHelper.settings.tags = undefined;

            settingsHelper.save();

        }

        if (settingsHelper.settings.debug != null && settingsHelper.settings.debug == true) {// jshint ignore:line
            self.onLog(settingsHelper.settings.nodeName.gray + ' successfully logged in'.green);
        }

        signInResponse = response;
        settingsHelper.settings.state = response.state;
        settingsHelper.settings.debug = response.debug;
        settingsHelper.settings.port = response.port == null ? 80 : response.port;
        settingsHelper.settings.tags = response.tags;
        settingsHelper.settings.enableTracking = response.enableTracking;

        _comSettings = response;

        if (settingsHelper.settings.enableTracking)
            self.onLog("Tracking: " + "Enabled".green);
        else
            self.onLog("Tracking: " + "Disabled".grey);

        if (settingsHelper.settings.state == "Active")
            self.onLog("State: " + settingsHelper.settings.state.green);
        else
            self.onLog("State: " + settingsHelper.settings.state.yellow);

        _itineraries = signInResponse.itineraries;

        applicationinsights.init(response.instrumentationKey, settingsHelper.settings.nodeName)
            .then(function (resp) {
                if (resp)
                    self.onLog("Application Insights:" + " Successfully initiated".green);
                else
                    self.onLog("Application Insights:" + " Disabled".grey);
            }, function (error) {
                self.onLog("Application Insights:" + " Failed to initiate!".green);
            });

        if (_firstStart) {
            _firstStart = false;

            self.onLog("IoT Provider: " + response.protocol.green)
            com = new Com(settingsHelper.settings.nodeName, response, settingsHelper.settings.hubUri, settingsHelper);

            com.OnStateReceivedCallback(function (stateMessage) {
                receiveState(stateMessage);
            });
            com.OnQueueMessageReceived(function (sbMessage) {
                var message = sbMessage.body;
                var service = sbMessage.applicationProperties.value.service;
                receiveMessage(message, service);
            });
            com.OnReceivedQueueError(function (message) {
                self.onLog("OnReceivedError: ".red + message);
            });
            com.OnSubmitQueueError(function (message) {
                self.onLog("OnSubmitError: ".red + message);
            });
            com.OnQueueDebugCallback(function (message) {
                if (settingsHelper.settings.debug != null && settingsHelper.settings.debug == true) {// jshint ignore:line
                    self.onLog("COM: ".green + message);
                }
            });
            com.OnActionCallback(function (message) {
                if (message.source == "core") {
                    switch (message.action) {
                        default:
                            self.onLog("Unsupported action: " + message.action);
                            break;
                    }

                }
                else {
                    if (self.onAction) {
                        self.onAction(message);
                    }
                }
            });

            port = process.env.PORT || 1337;
        }
        else {
            com.Update(response);
        }
        startAllServices(_itineraries, function () {
            self.onPingResponse();
            _restoreTimeout = setTimeout(function () {
                restorePersistedMessages();
            }, 3000);
        });


    }
    // Called by HUB when node has been successfully created    
    /* istanbul ignore next */
    MicroServiceBusNode.prototype.NodeCreated = function () {

        if (settingsHelper.settings.aws) {
            var awsSettings = { region: settingsHelper.settings.aws.region };
            let pemPath = path.resolve(settingsHelper.certDirectory, settingsHelper.settings.nodeName + ".cert.pem");
            let privateKeyPath = path.resolve(settingsHelper.certDirectory, settingsHelper.settings.nodeName + ".private.key");
            let settingsPath = path.resolve(settingsHelper.certDirectory, settingsHelper.settings.nodeName + ".settings");
            let caRootPath = path.resolve(settingsHelper.certDirectory, ".root-ca.crt");

            fs.writeFileSync(pemPath, settingsHelper.settings.aws.certificatePem);
            fs.writeFileSync(privateKeyPath, settingsHelper.settings.aws.privateKey);
            fs.writeFileSync(settingsPath, JSON.stringify(awsSettings));

            self.onLog("AWS node certificates installed");

            var caUri = "https://www.symantec.com/content/en/us/enterprise/verisign/roots/VeriSign-Class%203-Public-Primary-Certification-Authority-G5.pem";

            require("request")(caUri, function (err, response, certificateContent) {
                if (response.statusCode != 200 || err != null) {
                    self.onLog("unable to get aws root certificate");
                }
                else {
                    self.onLog("AWS root certificate installed");
                    fs.writeFileSync(caRootPath, certificateContent);
                    self.SignIn();
                }
            });
        }
        else
            self.SignIn();
    }
    // Signing in the to HUB
    MicroServiceBusNode.prototype.SignIn = function (newNodeName, temporaryVerificationCode, useMacAddress) {

        if (useMacAddress) {
            require('getmac').getMac(function (err, macAddress) {
                if (err) {
                    self.onLog('Unable to fetch mac address.');
                }
                else {
                    self.onCreateNodeFromMacAddress(macAddress);
                }
            })
        }
        // Logging in using code
        else if (settingsHelper.settings.nodeName == null || settingsHelper.settings.nodeName.length == 0) { // jshint ignore:line
            if (temporaryVerificationCode != undefined && temporaryVerificationCode.length == 0) { // jshint ignore:line
                self.onLog('No hostname or temporary verification code has been provided.');

            }
            else {

                this.onCreateNode(
                    temporaryVerificationCode,
                    hostPrefix,
                    newNodeName
                );
            }
        }
        // Logging in using settings
        else {

            var hostData = {
                Name: settingsHelper.settings.nodeName,
                machineName: settingsHelper.settings.machineName,
                OrganizationID: settingsHelper.settings.organizationId,
                npmVersion: this.nodeVersion,
                sas: settingsHelper.settings.sas
            };

            this.onSignedIn(hostData);


            if (settingsHelper.settings.debug != null && settingsHelper.settings.debug == true) {// jshint ignore:line
                self.onLog("Waiting for signin response".grey);
            }
        }
    }

    MicroServiceBusNode.prototype.InboundServices = function () {
        return _inboundServices;
    }

    MicroServiceBusNode.prototype.SetDebug = function (debug) {

        self.onLog(debug ? "Debug: ".white + "enabled".green : "Debug: ".white + "disabled".yellow);

        settingsHelper.settings.debug = debug;
    }

    // Events
    MicroServiceBusNode.prototype.OnSignedIn = function (callback) {
        this.onSignedIn = callback;
    };
    MicroServiceBusNode.prototype.OnStarted = function (callback) {
        this.onStarted = callback;
    };
    MicroServiceBusNode.prototype.OnStopped = function (callback) {
        this.onStopped = callback;
    };
    MicroServiceBusNode.prototype.OnPingResponse = function (callback) {
        this.onPingResponse = callback;
    };
    MicroServiceBusNode.prototype.OnUpdatedItineraryComplete = function (callback) {
        this.onUpdatedItineraryComplete = callback;
    };
    MicroServiceBusNode.prototype.OnLog = function (callback) {
        this.onLog = callback;
    };
    MicroServiceBusNode.prototype.OnAction = function (callback) {
        this.onAction = callback;
    };
    MicroServiceBusNode.prototype.OnCreateNode = function (callback) {
        this.onCreateNode = callback;
    };
    MicroServiceBusNode.prototype.OnCreateNodeFromMacAddress = function (callback) {
        this.onCreateNodeFromMacAddress = callback;
    };
    MicroServiceBusNode.prototype.OnReportLocation = function (callback) {
        this.onReportLocation = callback;
    };
    // Starting up all services
    function startAllServices(itineraries, callback) {
        stopAllServices(function () {
            loadItineraries(settingsHelper.settings.organizationId, itineraries, function () {
                callback();
            });
        });
    }

    // Stopping COM and all services
    function stopAllServices(callback) {

        stopAllServicesSync();

        callback();

        //com.Stop(function () {

        //    stopAllServicesSync();

        //    callback();
        //});
    }

    // Stopping all services
    function stopAllServicesSync() {
        if (_startWebServer) {
            self.onLog("Server:      " + "Shutting down web server".yellow);
            server.close();
            app = null;
            app = express();
        }

        if (_inboundServices.length > 0) {
            self.onLog("|" + util.padLeft("", 20, '-') + "|-----------|" + util.padLeft("", 40, '-') + "|");
            self.onLog("|" + util.padRight("Inbound service", 20, ' ') + "|  Status   |" + util.padRight("Flow", 40, ' ') + "|");
            self.onLog("|" + util.padLeft("", 20, '-') + "|-----------|" + util.padLeft("", 40, '-') + "|");

            for (var i = 0; i < _inboundServices.length; i++) {
                var service = _inboundServices[i];
                try {
                    service.Stop();
                    var lineStatus = "|" + util.padRight(service.Name, 20, ' ') + "| " + "Stopped".yellow + "   |" + util.padRight(service.IntegrationName, 40, ' ') + "|";
                    self.onLog(lineStatus);
                    service = undefined;
                    //delete service;
                }
                catch (ex) {
                    self.onLog('Unable to stop '.red + service.Name.red);
                    self.onLog(ex.message.red);
                }
            }

            if (server != undefined && server != null)
                server.close();

            _startWebServer = false;
            _downloadedScripts = undefined;
            //delete _downloadedScripts;
            _inboundServices = undefined;
            //delete _inboundServices;

            _downloadedScripts = [];
            _inboundServices = [];
        }
    }

    // Incoming state update
    function receiveState(newstate) {
        try {
            if (newstate.desired.msbaction) {
                if (newstate.desired.msbaction.action) {
                    if (!newstate.reported || !newstate.reported.msbaction || (newstate.reported.msbaction && (newstate.desired.msbaction.id !== newstate.reported.msbaction.id))) {
                        self.onLog("MSBACTION: ".green + newstate.desired.msbaction.action.grey);
                        com.currentState.reported = { msbaction: com.currentState.desired.msbaction };
                        var reportState = {
                            reported: { msbaction: com.currentState.desired.msbaction }
                        };
                        com.ChangeState(reportState, settingsHelper.settings.nodeName);

                        // Wait a bit for the state to update...
                        setTimeout(function () {
                            performActions(com.currentState.desired.msbaction);
                        }, 5000);

                    }
                    return;
                }
            }

            var microService = _inboundServices.find(function (i) {
                return i.baseType === "statereceiveadapter";
            });
            if (!microService)
                return;
            //getSuccessors
            var message = {};
            message.IsFirstAction = true;
            message.ContentType != 'application/json'
            message.body = newstate;
            message.messageBuffer = new Buffer(newstate);
            message._messageBuffer = new Buffer(newstate).toString('base64');

            microService.OnCompleted(function (integrationMessage, destination) {
                //    trackMessage(integrationMessage, destination, "Completed");
            });

            // Track incoming message
            trackMessage(message, microService.Name, "Started");

            // Submit state to service
            microService.Process(newstate, null);

        }
        catch (err) {
            self.onLog("Error at: ".red + microService.Name);
            self.onLog("Error id: ".red + err.name);
            self.onLog("Error description: ".red + err.message);
            trackException(message, microService.Name, "Failed", err.name, err.message);
        }
    }

    // Incoming messages
    function receiveMessage(message, destination) {
        try {
            var microService = _inboundServices.find(function (i) {
                return i.Name === destination &&
                    i.ItineraryId == message.ItineraryId;
            });
            /* istanbul ignore if */
            if (microService == null) {

                // isDynamicRoute means the node of the service was set to dynamic.
                // A dynamicly configured node setting whould mean the node was never initilized
                // and not part of the _inboundServices array.
                // Therefor it need to be initilized and started.
                if (message.isDynamicRoute) {

                    // Find the activity
                    var activity = message.Itinerary.activities.find(function (c) { return c.userData.id === destination; });

                    // Create a startServiceAsync request
                    var intineratyActivity = {
                        activity: activity,
                        itinerary: message.Itinerary
                    };

                    // Call startServiceAsync to initilized and start the service.
                    startServiceAsync(intineratyActivity, settingsHelper.settings.organizationId, true, function () {
                        self.onLog("");
                        self.onLog("|" + util.padLeft("", 20, '-') + "|-----------|" + util.padLeft("", 40, '-') + "|");
                        self.onLog("|" + util.padRight("Inbound service", 20, ' ') + "|  Status   |" + util.padRight("Flow", 40, ' ') + "|");
                        self.onLog("|" + util.padLeft("", 20, '-') + "|-----------|" + util.padLeft("", 40, '-') + "|");

                        microService = _inboundServices[_inboundServices.length - 1];
                        var lineStatus = "|" + util.padRight(microService.Name, 20, ' ') + "| " + "Started".green + "   |" + util.padRight(microService.IntegrationName, 40, ' ') + "|";
                        self.onLog(lineStatus);

                        self.onLog();

                        // Set the isDynamicRoute to false and call this method again.
                        microService.Start();
                        message.isDynamicRoute = false;
                        receiveMessage(message, destination)
                    });
                    return;
                }
                else {
                    var logm = "The service receiving this message is no longer configured to run on this node. This can happen when a service has been shut down and restarted on a different machine";
                    trackException(message, destination, "Failed", "90001", logm);
                    self.onLog(logm);
                    self.onLog("Error: ".red + logm);
                    return;
                }
            }

            message.IsFirstAction = false;
            microService.OnCompleted(function (integrationMessage, destination) {
                trackMessage(integrationMessage, destination, "Completed");
            });

            // Track incoming message
            trackMessage(message, destination, "Started");

            var buf = new Buffer(message._messageBuffer, 'base64');

            // Encrypted?
            if (message.Encrypted) {
                buf = util.decrypt(buf);
            }

            // CONSIDER CHANGE
            // const decoder = new StringEncoder('utf8');
            // var messageString = decoder.write(buf);

            var messageString = buf.toString('utf8');

            // Submit message to service
            if (message.ContentType != 'application/json') {
                microService.Process(messageString, message);
            }
            else {
                var obj = JSON.parse(messageString);
                microService.Process(obj, message);
            }

        }
        catch (err) {
            self.onLog("Error at: ".red + destination);
            self.onLog("Error id: ".red + err.name);
            self.onLog("Error description: ".red + err.message);
            trackException(message, destination, "Failed", err.name, err.message);
        }
    }

    // Restore persisted messages from ./persist folder
    function restorePersistedMessages() {

        fs.readdir(settingsHelper.persistDirectory, function (err, files) {
            if (err) throw err;
            for (var i = 0; i < files.length; i++) {
                var file = path.resolve(persistDirectory, files[i]);
                try {

                    var persistMessage = JSON.parse(fs.readFileSync(file, 'utf8'));

                    if (files[i].startsWith("_tracking_")) {
                        com.Track(persistMessage);
                    }
                    else {
                        com.Submit(persistMessage.message, persistMessage.node, persistMessage.service);
                    }
                }
                catch (se) {
                    var msg = "Unable to read persisted message: " + files[i];
                    self.onLog("Error: ".red + msg.grey)
                    try {
                        fs.unlinkSync(file);
                    }
                    catch (fex) { }
                }

                try {
                    fs.unlinkSync(file);
                }
                catch (fe) {
                    var msg = "Unable to delete file from persistent store. The message was successfully submitted, but will be submitted again after the node restarts.";
                    self.onLog("Error: ".red + msg.grey)
                }
            }
        });
    }

    // Handle incomming maintinance actions
    function performActions(msbAction) {
        switch (msbAction.action) {
            case 'stop':
                self.onLog("State changed to " + "Inactive".yellow);
                settingsHelper.settings.state = "InActive"
                stopAllServicesSync(function () {
                    self.onLog("All services stopped".yellow);
                });
                break;
            case 'start':
                self.onLog("State changed to " + "Active".green);
                settingsHelper.settings.state = "Active"
                _downloadedScripts = [];
                _inboundServices = [];
                startAllServices(_itineraries, function () { });
                break;
            case 'restart':
                break;
            case 'reboot':
                break;
            case 'script':
                break;
            default:
        }
    }

    // Called after successfull signin.
    // Iterates through all itineries and download the scripts, afterwhich the services is started
    function loadItineraries(organizationId, itineraries, callback) {
        // Prevent double loading
        if (_loadingState == "loading") {
            return;
        }

        if (itineraries.length == 0)
            self.onStarted(0, 0);

        async.map(itineraries,
            function (itinerary, callback) {
                var itineraryId = itinerary.itineraryId;
                // encapsulate each activity to work in async
                var intineratyActivities = [];
                for (var i = 0; i < itinerary.activities.length; i++) {
                    if (itinerary.activities[i].userData.config != undefined) {
                        var host = itinerary.activities[i].userData.config.generalConfig.find(function (c) { return c.id === 'host'; }).value;

                        if (host == settingsHelper.settings.nodeName) {
                            intineratyActivities.push({ itinerary: itinerary, activity: itinerary.activities[i] });
                        }
                        else if (settingsHelper.settings.tags !== undefined) {
                            var tags = settingsHelper.settings.tags.find(function (tag) { return tag === host });
                            if (tags !== undefined && tags.length > 0) {
                                if (itinerary.activities[i].userData.baseType === 'onewayreceiveadapter' || itinerary.activities[i].userData.baseType === 'twowayreceiveadapter') {
                                    itinerary.activities[i].userData.config.generalConfig.find(function (c) { return c.id === 'host'; }).value = settingsHelper.settings.nodeName;
                                }
                                intineratyActivities.push({ itinerary: itinerary, activity: itinerary.activities[i] });
                            }
                        }
                    }
                }
                async.map(intineratyActivities, function (intineratyActivity, callback) {
                    startServiceAsync(intineratyActivity, organizationId, false, function () {
                        callback(null, null);
                    });

                }, function (err, results) {
                    callback(null, null);
                });

            },
            function (err, results) {
                // Start com to receive messages
                //if (settingsHelper.settings.state === 'Active') {
                com.Start(function () {
                    self.onLog("");
                    self.onLog("|" + util.padLeft("", 20, '-') + "|-----------|" + util.padLeft("", 40, '-') + "|");
                    self.onLog("|" + util.padRight("Inbound service", 20, ' ') + "|  Status   |" + util.padRight("Flow", 40, ' ') + "|");
                    self.onLog("|" + util.padLeft("", 20, '-') + "|-----------|" + util.padLeft("", 40, '-') + "|");

                    for (var i = 0; i < _inboundServices.length; i++) {
                        var newMicroService = _inboundServices[i];

                        var serviceStatus = "Started".green;
                        if (settingsHelper.settings.state == "Active")
                            newMicroService.Start();
                        else
                            serviceStatus = "Stopped".yellow;

                        var lineStatus = "|" + util.padRight(newMicroService.Name, 20, ' ') + "| " + serviceStatus + "   |" + util.padRight(newMicroService.IntegrationName, 40, ' ') + "|";
                        self.onLog(lineStatus);
                    }
                    self.onLog();
                    if (self.onStarted)
                        self.onStarted(itineraries.length, exceptionsLoadingItineraries);

                    if (self.onUpdatedItineraryComplete != null)
                        self.onUpdatedItineraryComplete();

                    startListen();

                    _loadingState = "done";
                    callback();
                });
                //}
                //else
                //    callback();
            });
    }

    // Preforms the following tasks
    // 1. Checks if the service is enabled and continues to set the name of the script 
    // 2. Downloads the script
    // 3. Creatig the service and extends it from MicroService, and registring the events
    // 4. Starts the service
    function startServiceAsync(intineratyActivity, organizationId, forceStart, done) {
        try {
            var activity = intineratyActivity.activity;
            var itinerary = intineratyActivity.itinerary;
            if (activity.type === 'draw2d.Connection' || activity.type === 'LabelConnection') {
                done();
                return;
            }

            async.waterfall([
                // Init
                function (callback) {
                    try {
                        var host = activity.userData.config.generalConfig.find(function (c) { return c.id === 'host'; }).value;

                        var isEnabled = activity.userData.config.generalConfig.find(function (c) { return c.id === 'enabled'; }).value;

                        var hosts = host.split(',');
                        var a = hosts.indexOf(settingsHelper.settings.nodeName);

                        if (hosts.indexOf(settingsHelper.settings.nodeName) < 0 && !forceStart) {
                            done();
                            return;
                        }

                        var scriptFileUri = activity.userData.isCustom == true ?
                            settingsHelper.settings.hubUri + '/api/Scripts/' + settingsHelper.settings.organizationId + "/" + activity.userData.type + '.js' :
                            settingsHelper.settings.hubUri + '/api/Scripts/' + activity.userData.type + '.js';
                        scriptFileUri = scriptFileUri.replace('wss://', 'https://');

                        var integrationId = activity.userData.integrationId;

                        var scriptfileName = path.basename(scriptFileUri);

                        if (!isEnabled) {
                            var lineStatus = "|" + util.padRight(activity.userData.id, 20, ' ') + "| " + "Disabled".grey + "  |" + util.padRight(scriptfileName, 40, ' ') + "|";
                            self.onLog(lineStatus);
                            done();
                            return;
                        }
                        var exist = _downloadedScripts.find(function (s) { return s.name === scriptfileName; }); // jshint ignore:line    

                        callback(null, exist, scriptFileUri, scriptfileName, integrationId);
                    }
                    catch (error1) {
                        self.onLog(error1.message);
                        done();
                    }
                },
                // Download
                function (exist, scriptFileUri, scriptfileName, integrationId, callback) {
                    try {
                        require("request")(scriptFileUri, function (err, response, scriptContent) {
                            if (response.statusCode != 200 || err != null) {
                                self.onLog("Unable to get file:" + scriptfileName);
                                var lineStatus = "|" + util.padRight(activity.userData.id, 20, ' ') + "| " + "Not found".red + " |" + util.padRight(scriptfileName, 40, ' ') + "|";
                                self.onLog(lineStatus);
                                done();
                            }
                            else {
                                var localFilePath = path.resolve(__dirname, "services", scriptfileName);
                                fs.writeFileSync(localFilePath, scriptContent);
                                _downloadedScripts.push({ name: scriptfileName });
                                callback(null, localFilePath, integrationId, scriptfileName);
                            }
                        });
                    }
                    catch (error2) {
                        self.onLog(error2.message);
                        done();
                    }
                },
                // CreateService
                function (localFilePath, integrationId, scriptfileName, callback) {
                    try {
                        if (localFilePath == null) {
                            callback(null, null);
                        }
                        // Load an instance of the base class
                        // Extend the base class with the new class
                        //var newMicroService = extend(new MicroService(), reload(localFilePath));

                        var newMicroService = new MicroService(reload(localFilePath));
                        newMicroService.NodeName = settingsHelper.settings.nodeName;
                        newMicroService.OrganizationId = organizationId;
                        newMicroService.ItineraryId = itinerary.itineraryId;
                        newMicroService.Name = activity.userData.id;
                        newMicroService.Itinerary = itinerary;
                        newMicroService.IntegrationId = activity.userData.integrationId;
                        newMicroService.IntegrationName = itinerary.integrationName;
                        newMicroService.Environment = itinerary.environment;
                        newMicroService.TrackingLevel = itinerary.trackingLevel;
                        newMicroService.Init(activity.userData.config);
                        newMicroService.UseEncryption = settingsHelper.settings.useEncryption;
                        newMicroService.ComSettings = _comSettings;
                        newMicroService.baseType = activity.userData.baseType;
                        newMicroService.Com = com;

                        newMicroService.OnReceivedState(function (state, sender) {
                            com.ChangeState(state, sender);
                        });
                        // Eventhandler for messages sent back from the service
                        newMicroService.OnMessageReceived(function (integrationMessage, sender) {
                            try {
                                integrationMessage.OrganizationId = settingsHelper.settings.organizationId;

                                if (integrationMessage.FaultCode != null) {
                                    trackException(integrationMessage,
                                        integrationMessage.LastActivity,
                                        "Failed",
                                        integrationMessage.FaultCode,
                                        integrationMessage.FaultDescripton);

                                    self.onLog('Exception: '.red + integrationMessage.FaultDescripton);
                                    return;
                                }

                                trackMessage(integrationMessage, integrationMessage.LastActivity, integrationMessage.IsFirstAction ? "Started" : "Completed");

                                // Process the itinerary to find next service
                                var successors = getSuccessors(integrationMessage);

                                successors.forEach(function (successor) {
                                    integrationMessage.Sender = settingsHelper.settings.nodeName;

                                    // No correlation
                                    try {
                                        var messageString = '';
                                        if (integrationMessage.ContentType != 'application/json') {
                                            var buf = new Buffer(integrationMessage._messageBuffer, 'base64');
                                            messageString = buf.toString('utf8');
                                        }

                                        var destination = sender.ParseString(successor.userData.host, messageString, integrationMessage);
                                        integrationMessage.isDynamicRoute = destination != successor.userData.host;
                                        destination.split(',').forEach(function (destinationNode) {

                                            // Encrypt?
                                            if (settingsHelper.settings.useEncryption == true) {
                                                var messageBuffer = new Buffer(integrationMessage._messageBuffer, 'base64');
                                                messageBuffer = util.encrypt(messageBuffer);
                                                integrationMessage.Encrypted = true;
                                                integrationMessage._messageBuffer = messageBuffer;
                                                // integrationMessage.MessageBuffer = messageBuffer;
                                            }

                                            if (destinationNode == settingsHelper.settings.nodeName)
                                                receiveMessage(integrationMessage, successor.userData.id);
                                            else {
                                                if (typeof integrationMessage._messageBuffer != "string") {
                                                    integrationMessage._messageBuffer = integrationMessage._messageBuffer.toString('base64');
                                                    //integrationMessage.MessageBuffer = integrationMessage._messageBuffer;
                                                }
                                                com.Submit(integrationMessage,
                                                    destinationNode.toLowerCase(),
                                                    successor.userData.id);
                                            }
                                        });

                                    }
                                    catch (err) {
                                        self.onLog(err);
                                    }

                                });
                            }
                            catch (generalEx) {
                                self.onLog(generalEx.message);
                            }
                        });
                        // [DEPRICATED]Eventhandler for any errors sent back from the service
                        newMicroService.OnError(function (source, errorId, errorDescription) {
                            self.onLog("The Error method is deprecated. Please use the ThrowError method instead.".red);
                            self.onLog("Error at: ".red + source);
                            self.onLog("Error id: ".red + errorId);
                            self.onLog("Error description: ".red + errorDescription);
                        });
                        // Eventhandler for any debug information sent back from the service
                        newMicroService.OnDebug(function (source, info) {
                            if (settingsHelper.settings.debug != null && settingsHelper.settings.debug == true) {// jshint ignore:line
                                self.onLog("DEBUG: ".green + '['.gray + source.gray + ']'.gray + '=>'.green + info);
                                applicationinsights.trackEvent("Tracking", { service: source, state: info });
                            }
                        });
                        // Eventhander for reporting location 
                        newMicroService.OnReportLocation(function (source, info) {

                        });
                        callback(null, newMicroService, scriptfileName);
                    }
                    catch (error3) {
                        if (newMicroService === undefined) {
                            self.onLog('Unable to load '.red + localFilePath.red + ' ' + error3);
                        }
                        else
                            self.onLog('Unable to start service '.red + newMicroService.Name.red + ' ' + error3);

                        done();
                    }
                },
                // StartService
                function (newMicroService, scriptfileName, callback) {
                    if (newMicroService == null) {
                        callback(null, null);
                    }
                    // Start the service
                    try {
                        _inboundServices.push(newMicroService);
                        if (activity.userData.isInboundREST || activity.userData.type === "azureApiAppInboundService") {

                            if (!_startWebServer) {
                                http = require('http');
                                express = require('express');
                                //swaggerize = require('swaggerize-express');
                                bodyParser = require('body-parser');
                                app = express();

                                app.use(function (req, res, next) {


                                    var allowAnonymous = true;
                                    var basicAuth = false;
                                    //var allowedUserName = "john";
                                    //var allowedUserPassword = "secret";

                                    if (!allowAnonymous && basicAuth) { // Basic only
                                        util.addNpmPackage("basic-auth", function (err) {
                                            auth = require('basic-auth');
                                            var credentials = auth(req);
                                            if (!credentials) {
                                                res.statusCode = 401
                                                res.setHeader('WWW-Authenticate', 'Basic realm="microservicebus.com"')
                                                res.end('Access denied')
                                            }
                                            else {
                                                if (credentials.name !== allowedUserName || credentials.pass !== allowedUserPassword) {
                                                    res.statusCode = 401
                                                    res.end('Access denied')
                                                }
                                                else {
                                                    req.AuthenticatedUser = credentials.name;
                                                    next();
                                                }
                                            }
                                        });

                                    }
                                    else if (allowAnonymous && basicAuth) {
                                        if (credentials) {
                                            if (credentials.name !== allowedUserName || credentials.pass !== allowedUserPassword) {
                                                res.statusCode = 401
                                                res.end('Access denied')
                                            }
                                            else {
                                                req.AuthenticatedUser = credentials.name;
                                                next();
                                            }
                                        }
                                        else {
                                            next();
                                        }
                                    }
                                    else { // Only Anonymous
                                        next();
                                    }
                                });


                                _startWebServer = true;
                            }
                            newMicroService.App = app;
                        }
                        callback(null, 'done');
                    }
                    catch (ex) {
                        self.onLog('Unable to start service '.red + newMicroService.Name.red);
                        if (typeof ex === 'object')
                            self.onLog(ex.message.red);
                        else
                            self.onLog(ex.red);

                        exceptionsLoadingItineraries++;
                        callback(null, 'exception');
                    }
                }
            ], done);
        }
        catch (ex2) {
            self.onLog('Unable to start service.'.red);
            self.onLog(ex2.message.red);
        }
    }

    // The listner is used for incoming REST calls and is started
    // only if there is an inbound REST service
    function startListen() {
        if (!_startWebServer)
            return;

        try {
            if (settingsHelper.settings.port != undefined)
                port = settingsHelper.settings.port;

            self.onLog("Listening to port: " + settingsHelper.settings.port);
            self.onLog();

            //app.use(bodyParser.json());

            server = http.createServer(app);

            // parse application/x-www-form-urlencoded
            app.use(bodyParser.urlencoded({ extended: false }))

            // parse application/json
            app.use(bodyParser.json())

            app.use(function (req, res) {
                res.header('Content-Type', 'text/html');
                var response = '<style>body {font-family: "Helvetica Neue",Helvetica,Arial,sans-serif; background: rgb(52, 73, 94); color: white;}</style>';
                response += '<h1><img src="https://microservicebus.com/Images/Logotypes/Logo6.svg" style="height:75px"/> Welcome to the ' + settingsHelper.settings.nodeName + ' node</h1><h2 style="margin-left: 80px">API List</h2>';

                app._router.stack.forEach(function (endpoint) {
                    if (endpoint.route != undefined) {
                        if (endpoint.route.methods["get"] != undefined && endpoint.route.methods["get"] == true)
                            response += '<div style="margin-left: 80px"><b>GET</b> ' + endpoint.route.path + "</div>";
                        if (endpoint.route.methods["delete"] != undefined && endpoint.route.methods["delete"] == true)
                            response += '<div style="margin-left: 80px"><b>DELETE</b> ' + endpoint.route.path + "</div>";
                        if (endpoint.route.methods["post"] != undefined && endpoint.route.methods["post"] == true)
                            response += '<div style="margin-left: 80px"><b>POST</b> ' + endpoint.route.path + "</div>";
                        if (endpoint.route.methods["put"] != undefined && endpoint.route.methods["put"] == true)
                            response += '<div style="margin-left: 80px"><b>PUT</b> ' + endpoint.route.path + "</div>";
                    }
                });

                res.send(response);
            })

            app.use('/', express.static(__dirname + '/html'));

            self.onLog("REST endpoints:".green);
            app._router.stack.forEach(function (endpoint) {
                if (endpoint.route != undefined) {
                    if (endpoint.route.methods["get"] != undefined && endpoint.route.methods["get"] == true)
                        self.onLog("GET:    ".yellow + endpoint.route.path);
                    if (endpoint.route.methods["delete"] != undefined && endpoint.route.methods["delete"] == true)
                        self.onLog("DELETE: ".yellow + endpoint.route.path);
                    if (endpoint.route.methods["post"] != undefined && endpoint.route.methods["post"] == true)
                        self.onLog("POST:   ".yellow + endpoint.route.path);
                    if (endpoint.route.methods["put"] != undefined && endpoint.route.methods["put"] == true)
                        self.onLog("PUT:    ".yellow + endpoint.route.path);
                }
            });

            server = http.createServer(app).listen(port, function (err) {
                self.onLog("Server started on port: ".green + port);
                self.onLog();
            });
        }
        catch (e) {
            self.onLog('Unable to start listening on port ' + port);
        }
    }

    // Returns the next services in line to be executed.
    function getSuccessors(integrationMessage) {

        var itinerary = integrationMessage.Itinerary;
        var serviceName = integrationMessage.LastActivity;
        var lastActionId = itinerary.activities.find(function (action) { return action.userData.id === serviceName; }).id;

        var connections = itinerary.activities.filter(function (connection) {
            return connection.source !== undefined &&
                connection.source.node !== undefined &&
                connection.source.node === lastActionId &&
                (connection.type === 'draw2d.Connection' || connection.type === 'LabelConnection');
        });

        var successors = [];

        connections.forEach(function (connection) {
            if (connection.source.node == lastActionId) {
                var successor = itinerary.activities.find(function (action) { return action.id === connection.target.node; });

                if (validateRoutingExpression(successor, integrationMessage)) {
                    var destination = successor.userData.config.generalConfig.find(function (c) { return c.id === 'host'; }).value;

                    successor.userData.host = destination;
                    successors.push(successor);
                }
            }
        });

        return successors;
    }

    // Evaluates the routing expression
    function validateRoutingExpression(actitity, integrationMessage) {
        var expression;
        try {
            var routingExpression = actitity.userData.config.staticConfig.find(function (c) { return c.id === 'routingExpression'; });
            if (routingExpression == null) // jshint ignore:line
                return true;

            var messageString = '{}';
            if (integrationMessage.ContentType == 'application/json') {
                var buf = new Buffer(integrationMessage._messageBuffer, 'base64');
                messageString = buf.toString('utf8');
            }
            // Add variables
            var varialbesString = '';
            if (integrationMessage.Variables != null) { // jshint ignore:line
                integrationMessage.Variables.forEach(function (variable) {
                    switch (variable.Type) {
                        case 'String':
                        case 'DateTime':
                            varialbesString += 'var ' + variable.Variable + ' = ' + "'" + variable.Value + "';\n";
                            break;
                        case 'Number':
                        case 'Decimal':
                            varialbesString += 'var ' + variable.Variable + ' = ' + variable.Value + ";\n";
                            break;
                        case 'Message':
                            var objString = JSON.stringify(variable.Value);
                            varialbesString += 'var ' + variable.Variable + ' = ' + objString + ";\n";
                            break;
                        default:
                            break;
                    }
                });
            }
            routingExpression.value = routingExpression.value.replace("var route =", "route =");
            expression = '"use strict"; var message =' + messageString + ';\n' + varialbesString + routingExpression.value;

            var route;
            var o = eval(expression); // jshint ignore:line
            return route;
        }
        catch (ex) {
            self.onLog("Unable to run script: ".red + expression.gray);
            throw "Unable to run script: " + expression;
        }
    }

    // Submits tracking data to host
    function trackMessage(msg, lastActionId, status) {
        if (!settingsHelper.settings.enableTracking)
            return;

        if (typeof msg._messageBuffer != "string") {
            msg._messageBuffer = msg._messageBuffer.toString('base64');
        }

        var time = moment();
        var messageId = guid.v1();

        if (msg.IsFirstAction && status == "Completed")
            msg.IsFirstAction = false;

        // Remove message if encryption is enabled?
        if (settingsHelper.settings.useEncryption == true) {
            msg._messageBuffer = new Buffer("[ENCRYPTED]").toString('base64');
        }

        var trackingMessage = {
            _message: msg._messageBuffer,
            ContentType: msg.ContentType,
            LastActivity: lastActionId,
            NextActivity: null,
            Node: settingsHelper.settings.nodeName,
            MessageId: messageId,
            OrganizationId: settingsHelper.settings.organizationId,
            InterchangeId: msg.InterchangeId,
            ItineraryId: msg.ItineraryId,
            IntegrationName: msg.IntegrationName,
            Environment: msg.Environment,
            TrackingLevel: msg.TrackingLevel,
            IntegrationId: msg.IntegrationId,
            IsFault: false,
            IsEncrypted: settingsHelper.settings.useEncryption == true,
            FaultCode: msg.FaultCode,
            FaultDescription: msg.FaultDescripton,
            IsFirstAction: msg.IsFirstAction,
            TimeStamp: time.utc().toISOString(),
            State: status,
            Variables: msg.Variables
        };
        com.Track(trackingMessage);

    }

    // Submits exception message for tracking
    function trackException(msg, lastActionId, status, fault, faultDescription) {

        var time = moment();
        var messageId = guid.v1();

        var trackingMessage =
            {
                _message: msg.MessageBuffer,
                ContentType: msg.ContentType,
                LastActivity: lastActionId,
                NextActivity: null,
                Node: settingsHelper.settings.nodeName,
                MessageId: messageId,
                Variables: null,
                OrganizationId: settingsHelper.settings.organizationId,
                IntegrationName: msg.IntegrationName,
                Environment: msg.Environment,
                TrackingLevel: msg.TrackingLevel,
                InterchangeId: msg.InterchangeId,
                ItineraryId: msg.ItineraryId,
                IntegrationId: msg.IntegrationId,
                FaultCode: msg.FaultCode,
                FaultDescription: msg.FaultDescripton,
                IsFirstAction: msg.IsFirstAction,
                TimeStamp: time.utc().toISOString(),
                IsFault: true,
                State: status
            };
        com.Track(trackingMessage);
        applicationinsights.trackException(trackingMessage);
    };

}

module.exports = MicroServiceBusNode;

//MicroServiceBusNode.DebugClient = require('./DebugHost.js');