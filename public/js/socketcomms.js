//"use strict";
var socket, isConnected, connectVia;
var jobStartTime = -1;
var playing = false;
var paused = false;
var queueEmptyCount = 0;
var laserTestOn = false;
var firmware;
var ovStep = 1;
var ovLoop;
var server = ''; //192.168.14.100';

function initSocket() {
    socket = io.connect(server); // socket.io init
    socket.emit('firstLoad', 1);

    socket.on('config', function (data) {
        console.log('config' + data);
    });

    socket.on('activePorts', function (data) {
        console.log('activePorts' + data);
    });

    socket.on('ports', function (data) {
        $('#syncstatus').html('Socket Init');
        var options = $("#port");
        for (var i = 0; i < data.length; i++) {
            options.append($("<option />").val(data[i].comName).text(data[i].comName));
        }
        $('#connect').removeClass('disabled');
        // Might as well pre-select the last-used port and buffer
        var lastUsed = loadSetting("lastUsedPort");
        var lastBaud = loadSetting("lastUsedBaud");
        $("#port option:contains(" + lastUsed + ")").attr('selected', 'selected');
        $("#baud option:contains(" + lastBaud + ")").attr('selected', 'selected');
    });

    socket.on('connectStatus', function (data) {
        console.log(data);
        $('#connectStatus').html(data);
        $('#syncstatus').html('Socket OK');
        if (data.indexOf('opened') >= 0) {
            isConnected = true;
            $('#closePort').removeClass('disabled');
        }
    });

    socket.on('data', function (data) {
        $('#syncstatus').html('Socket OK');
        // isConnected = true;
        if (data.indexOf('<') === 0) {
            updateStatus(data);
        } else if (data.indexOf('{\"sr\"') === 0) {
            updateStatusTinyG(data);
        } else if (data === 'ok') {
            printLog(data, '#cccccc', "usb");
        } else {
            printLog(data, msgcolor, "usb");
        }
        if (data.indexOf('LPC176')) { //LPC1768 or LPC1769 should be Smoothie
            $('#overrides').removeClass('hide');
            $('#motorsOff').show();
            $('homeX').show();
            $('homeY').show();
            $('homeZ').show();
        }
        if (data.indexOf('Grbl') === 0) {
            if (parseFloat(data.substr(5)) >= 1.1) { //is Grbl >= v1.1
                $('#overrides').removeClass('hide');
                $('#motorsOff').hide();
                $('homeX').hide();
                $('homeY').hide();
                $('homeZ').hide();
            } else {
                socket.emit('closePort', 1);
                isConnected = false;
                $('#closePort').addClass('disabled');
                $('#machineStatus').html('Not Connected');
                $("#machineStatus").removeClass('badge-ok');
                $("#machineStatus").addClass('badge-notify');
                $("#machineStatus").removeClass('badge-warn');
                $("#machineStatus").removeClass('badge-busy');
                $('#overrides').addClass('hide');
                printLog("<b><u>You need to update GRBL firmware to the latest version 1.1d!</u></b> (see <a href=\"https://github.com/LaserWeb/LaserWeb3/wiki/Firmware:-GRBL-1.1d\">Wiki</a> for details)", errorcolor, "usb");
            }
        }
    });

    // smoothie feed override report (from server)
    socket.on('feedOverride', function (data) {
        $('#oF').html(data.toString() + '<span class="drounitlabel"> %</span>');
    });

    // smoothie spindle override report (from server)
    socket.on('spindleOverride', function (data) {
        $('#oS').html(data.toString() + '<span class="drounitlabel"> %</span>');
    });

    $('#refreshPort').on('click', function () {
        $('#port').find('option').remove().end();
        socket.emit('refreshPorts', 1);
        $('#syncstatus').html('Socket Refreshed');
    });

    $('#connect').on('click', function () {
        var portName = $('#port').val();
        var baudRate = $('#baud').val();
        socket.emit('connectTo', portName + ',' + baudRate);
        isConnected = true;
        saveSetting("lastUsedPort", portName);
        saveSetting("lastUsedBaud", baudRate);
        $('#closePort').removeClass('disabled');
    });

    $('#closePort').on('click', function () {
        socket.emit('closePort', 1);
        isConnected = false;
        $('#closePort').addClass('disabled');
        $('#machineStatus').html('Not Connected');
        $("#machineStatus").removeClass('badge-ok');
        $("#machineStatus").addClass('badge-notify');
        $("#machineStatus").removeClass('badge-warn');
        $("#machineStatus").removeClass('badge-busy');
        $('#overrides').addClass('hide');
    });

    $('#sendCommand').on('click', function () {
        var commandValue = $('#command').val();
        sendGcode(commandValue);
        $('#command').val('');
    });

    socket.on('qCount', function (data) {
        data = parseInt(data);
        $('#queueCnt').html('Queued: ' + data);
        if (data === 0) {
            queueEmptyCount++;
            if (queueEmptyCount == 4) {
                playing = false;
                paused = false;
                $('#playicon').removeClass('fa-pause');
                $('#playicon').addClass('fa-play');

                if (jobStartTime >= 0) {
                    var jobFinishTime = new Date(Date.now());
                    var elapsedTimeMS = jobFinishTime.getTime() - jobStartTime.getTime();
                    var elapsedTime = Math.round(elapsedTimeMS / 1000);
                    printLog("Job started at " + jobStartTime.toString(), msgcolor, "file");
                    printLog("Job finished at " + jobFinishTime.toString(), msgcolor, "file");
                    printLog("Elapsed time: " + elapsedTime + " seconds.", msgcolor, "file");
                    jobStartTime = -1;

                    // Update accumulated job time
                    var accumulatedJobTimeMS = accumulateTime(elapsedTimeMS);

                    printLog("Total accumulated job time: " + (accumulatedJobTimeMS / 1000).toHHMMSS());
                }
            }
        }
    });

}

function sendGcode(gcode) {
    // printLog("<i class='fa fa-arrow-right' aria-hidden='true'></i>"+ gcode, msgcolor)
    if (gcode) {
        // console.log('Sending', gcode)
        var connectVia = $('#connectVia').val();
        if (connectVia === "USB") {
            socket.emit('serialSend', gcode);
        } else if (connectVia === "Ethernet") {
            runCommand(gcode);
        } else if (connectVia === "ESP8266") {
            if (ws) {
                if (ws.readyState == '1') {
                    ws.send(gcode);
                } else {
                    printLog("Unable to send gcode: Not connected to Websocket: " + gcode, errorcolor, "wifi");
                }
            } else {
                printLog("Unable to send gcode: Not connected: " + gcode, errorcolor, "wifi");
            }
        }
    }
}

function stopMachine() {
    var laseroffcmd = document.getElementById('laseroff').value;
    var connectVia = $('#connectVia').val();
    if (connectVia === "USB") {
        if (laseroffcmd) {
            socket.emit('stop', laseroffcmd);
        } else {
            socket.emit('stop', 0);
        }
    } else if (connectVia === "Ethernet") {
        if (laseroffcmd) {
            runCommand('abort');
            runCommand(laseroffcmd);
            runCommand('\030');
            runCommand('$X');
            runCommand(laseroffcmd);
        } else {
            runCommand('abort');
            runCommand('\030');
        }
    } else if (connectVia === "ESP8266") {
        if (laseroffcmd) {
            gcodeQueue = [];
            sendGcode(laseroffcmd);
            sendGcode('abort');
            sendGcode(laseroffcmd);
        } else {
            gcodeQueue = [];
            sendGcode('abort');
        }
        $('#queueCnt').html('Queued: ' + gcodeQueue.length);
    }
    $('#playicon').addClass('fa-play');
    $('#playicon').removeClass('fa-pause');
    playing = false;
    paused = false;
}

function playpauseMachine() {
    if (isConnected) {
        var connectVia = $('#connectVia').val();
        if (playing === true) {
            if (paused === true) {
                // unpause
                var laseroncmd = document.getElementById('laseron').value;
                if (laseroncmd.length === 0) {
                    laseroncmd = 0;
                }
                if (connectVia === "USB") {
                    socket.emit('unpause', laseroncmd);
                } else if (connectVia === "Ethernet") {
                    runCommand('resume');
                } else if (connectVia === "ESP8266") {
                    // Do nothing.  The paused var starts the uploadLine function
                    paused = false;
                    uploadLine();
                }
                paused = false;
                $('#playicon').removeClass('fa-play');
                $('#playicon').addClass('fa-pause');
                // end ifPaused
            } else {
                // pause
                var laseroffcmd = document.getElementById('laseroff').value;
                if (laseroffcmd.length === 0) {
                    laseroffcmd = 0;
                }
                if (connectVia === "USB") {
                    socket.emit('pause', laseroffcmd);
                } else if (connectVia === "Ethernet") {
                    if (laseroffcmd !== 0) {
                        runCommand('suspend');
                        runCommand(laseroffcmd);
                    } else {
                        runCommand('pause');
                    }
                } else if (connectVia === "ESP8266") {
                    if (laseroffcmd !== 0) {
                        sendGcode("suspend");
                        sendGcode(laseroffcmd);
                    } else {
                        // Do nothing.  The paused var stops the uploadLine function
                    }
                }
                paused = true;
                $('#playicon').removeClass('fa-pause');
                $('#playicon').addClass('fa-play');
            }
            // end isPlaying
        } else {
            playGcode();
        }
        // end isConnected
    } else {
        printLog('You have to Connect to a machine First!', errorcolor, "usb");
    }
}

function playGcode() {
    jobStartTime = new Date(Date.now());
    printLog("Job started at " + jobStartTime.toString(), msgcolor, "file");
    var connectVia = $('#connectVia').val();
    queueEmptyCount = 0;
    if (connectVia === "USB") {
        if (isConnected) {
            var g;
            g = prepgcodefile();
            playing = true;
            $('#playicon').removeClass('fa-play');
            $('#playicon').addClass('fa-pause');
            sendGcode(g);
        } else {
            printLog('Not Connected', errorcolor, "usb");
        }
    } else if (connectVia === "Ethernet") {
        // Upload to SD Wizard
    } else if (connectVia === "ESP8266") {
        // Upload to SD
        $('#playicon').removeClass('fa-play');
        $('#playicon').addClass('fa-pause');
        playing = true;
        espPlay();
    }
}


var lastPosx = 0,
    lastPosy = 0,
    lastPosz = 0;

function updateStatusTinyG(data) {
    var jsObject = JSON.parse(data);
    console.log(jsObject)
    if (jsObject.sr.posx) {
        lastPosx = jsObject.sr.posx
    }
    if (jsObject.sr.posy) {
        lastPosy = jsObject.sr.posy
    }
    if (jsObject.sr.posz) {
        lastPosz = jsObject.sr.posz
    }
    var xpos = parseFloat(lastPosx).toFixed(2);
    var ypos = parseFloat(lastPosy).toFixed(2);
    var zpos = parseFloat(lastPosz).toFixed(2);

    $('#mX').html(xpos);
    $('#mY').html(ypos);
    $('#mZ').html(zpos);
    if (bullseye) {
        setBullseyePosition(xpos, ypos, zpos); // Also updates #mX #mY #mZ
    }
}

function updateStatus(data) {
    // Smoothieware: <Idle,MPos:49.5756,279.7644,-15.0000,WPos:0.0000,0.0000,0.0000>
    // till GRBL v0.9: <Idle,MPos:0.000,0.000,0.000,WPos:0.000,0.000,0.000>
    // since GRBL v1.1: <Idle|WPos:0.000,0.000,0.000|Bf:15,128|FS:0,0|Pn:S|WCO:0.000,0.000,0.000> (when $10=2)

    // Extract state
    var state = data.substring(data.indexOf('<') + 1, data.search(/(,|\|)/));
    if (state === 'Alarm') {
        $("#machineStatus").removeClass('badge-ok');
        $("#machineStatus").addClass('badge-notify');
        $("#machineStatus").removeClass('badge-warn');
        $("#machineStatus").removeClass('badge-busy');
        if ($('#alarmmodal').is(':visible')) {
            // Nothing, its already open
        } else {
            $('#alarmmodal').modal('show');
        }
    } else if (state === 'Home') {
        $("#machineStatus").removeClass('badge-ok');
        $("#machineStatus").removeClass('badge-notify');
        $("#machineStatus").removeClass('badge-warn');
        $("#machineStatus").addClass('badge-busy');
        if ($('#alarmmodal').is(':visible')) {
            $('#alarmmodal').modal('hide');
        }
    } else if (state === 'Hold') {
        $("#machineStatus").removeClass('badge-ok');
        $("#machineStatus").removeClass('badge-notify');
        $("#machineStatus").addClass('badge-warn');
        $("#machineStatus").removeClass('badge-busy');
        if ($('#alarmmodal').is(':visible')) {
            $('#alarmmodal').modal('hide');
        }
    } else if (state === 'Idle') {
        $("#machineStatus").addClass('badge-ok');
        $("#machineStatus").removeClass('badge-notify');
        $("#machineStatus").removeClass('badge-warn');
        $("#machineStatus").removeClass('badge-busy');
        if ($('#alarmmodal').is(':visible')) {
            $('#alarmmodal').modal('hide');
        }
    } else if (state === 'Run') {
        $("#machineStatus").removeClass('badge-ok');
        $("#machineStatus").removeClass('badge-notify');
        $("#machineStatus").removeClass('badge-warn');
        $("#machineStatus").addClass('badge-busy');
        if ($('#alarmmodal').is(':visible')) {
            $('#alarmmodal').modal('hide');
        }
    }
    $('#machineStatus').html(state);

    // Extract Pos
    var startPos = data.search(/wpos:/i) + 5;
    var pos;
    if (startPos > 5) {
        pos = data.replace('>', '').substr(startPos).split(/,|\|/, 3);
    } else {
        startPos = data.search(/mpos:/i) + 5;
        if (startPos > 5) {
            pos = data.replace('>', '').substr(startPos).split(/,|\|/, 3);
        }
    }
    if (Array.isArray(pos)) {
        var xpos = parseFloat(pos[0]).toFixed(2);
        var ypos = parseFloat(pos[1]).toFixed(2);
        var zpos = parseFloat(pos[2]).toFixed(2);

        $('#mX').html(xpos);
        $('#mY').html(ypos);
        $('#mZ').html(zpos);
        if (bullseye) {
            setBullseyePosition(pos[0], pos[1], pos[2]); // Also updates #mX #mY #mZ
        }
    }

    // Extract override values (for Grbl > v1.1 only!)
    startOv = data.search(/ov:/i) + 3;
    if (startOv > 3) {
        var ov = data.replace('>', '').substr(startOv).split(/,|\|/, 3);
        //printLog("Overrides: " + ov[0] + ',' + ov[1] + ',' + ov[2],  msgcolor, "USB");
        if (Array.isArray(ov)) {
            $('#oF').html(ov[0].trim() + '<span class="drounitlabel"> %</span>');
            //$('#oR').html(ov[1].trim() + '%');
            $('#oS').html(ov[2].trim() + '<span class="drounitlabel"> %</span>');
        }
    }

    // Extract realtime Feedrate (for Grbl > v1.1 only!)
    var startFS = data.search(/FS:/i) + 3;
    if (startFS > 3) {
        var fs = data.replace('>', '').substr(startFS).split(/,|\|/, 2);
        if (Array.isArray(fs)) {
            //$('#mF').html(fs[0].trim());
            //$('#mS').html(fs[1].trim());
        }
    }
}

function override(param, value) {
    if (isConnected) {
        var connectVia = $('#connectVia').val();
        if (connectVia === "USB") {
            switch (param) {
                case 'F':
                    socket.emit('feedOverride', value);
                    break;
                case 'S':
                    socket.emit('spindleOverride', value);
                    break;
            }
        } else if (connectVia === "Ethernet") {
            runCommand(value);
        } else if (connectVia === "ESP8266") {
            // needs to be programmed
        }
    } else {
        printLog('You have to Connect to a machine First!', errorcolor, "usb");
    }
}

function laserTest(power, duration) {
    if (isConnected) {
        var connectVia = $('#connectVia').val();
        if (connectVia === "USB") {
            if (!power || !duration) {
                printLog('You must setup "LaserTest Power" and "LaserTest Duratuion" first!', errorcolor, "usb");
            } else {
                socket.emit('laserTest', power + ',' + duration);
            }
        } else if (connectVia === "Ethernet") {
            // needs to be programmed
        } else if (connectVia === "ESP8266") {
            // needs to be programmed
        }
    } else {
        printLog('You have to Connect to a machine First!', errorcolor, "usb");
    }
}

// 1 = clear alarm state and resume queueCnt
// 2 = clear quue, clear alarm state, and wait for new queue
function clearQueueAlarm(value) {
    socket.emit('clearAlarm', value);
}