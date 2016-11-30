"use strict";
/*

    AUTHOR:  Peter van der Walt openhardwarecoza.github.io/donate

    THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
    WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
    MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
    ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
    WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
    ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
    OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.

*/
var config = require('./config');
var serialport = require("serialport");
var SerialPort = serialport;
var app = require('http').createServer(handler);
var io = require('socket.io').listen(app);
var fs = require('fs');
var nstatic = require('node-static');
var EventEmitter = require('events').EventEmitter;
var url = require('url');
var qs = require('querystring');
var util = require('util');
var http = require('http');
var chalk = require('chalk');
var isConnected, connectedTo, port, isBlocked, lastSent = "", paused = false, blocked = false, queryLoop, queueCounter, connections = [];
var gcodeQueue; gcodeQueue = [];
var request = require('request'); // proxy for remote webcams
var firmware = 'smoothie';
var feedOverride = 100;
var spindleOverride = 100;
var laserTestOn = false;


require('dns').lookup(require('os').hostname(), function (err, add, fam) {
    console.log(chalk.green(' '));
    console.log(chalk.green('***************************************************************'));
    console.log(chalk.white('                 ---- LaserWeb Started ----                    '));
    console.log(chalk.green('***************************************************************'));
    console.log(chalk.white('  Access the LaserWeb User Interface:                        '));
    console.log(chalk.green('  1. Open Chrome                                              '));
    console.log(chalk.green('  2. Go to : '), chalk.yellow(' http://'+add+':'+config.webPort+'/'));
    console.log(chalk.green('***************************************************************'));
    console.log(chalk.green(' '));
    console.log(chalk.green(' '));
    console.log(chalk.red('* Updates: '));
    console.log(chalk.green('  Remember to check the commit log on'));
    console.log(chalk.green(' '), chalk.yellow('https://github.com/openhardwarecoza/LaserWeb3/commits/master'));
    console.log(chalk.green('  regularly, to know about updates and fixes, and then when ready'));
    console.log(chalk.green('  update LaserWeb3 accordingly by running'), chalk.cyan("git pull"));
    console.log(chalk.green(' '));
    console.log(chalk.red('* Support: '));
    console.log(chalk.green('  If you need help / support, come over to '));
    console.log(chalk.green(' '), chalk.yellow('https://plus.google.com/communities/115879488566665599508'));
});


// Webserver
app.listen(config.webPort);
var fileServer = new nstatic.Server('./public');
function handler (req, res) {

  var queryData = url.parse(req.url, true).query;
      if (queryData.url) {
        if (queryData.url != "") {
          request({
              url: queryData.url,  // proxy for remote webcams
              callback: (err, res, body) => {
                if (err) {
                  // console.log(err)
                  console.error(chalk.red('ERROR:'), chalk.yellow(' Remote Webcam Proxy error: '), chalk.white("\""+queryData.url+"\""), chalk.yellow(' is not a valid URL: '));
                }
              }
          }).on('error', function(e) {
              res.end(e);
          }).pipe(res);
        }
      } else {
        fileServer.serve(req, res, function (err, result) {
      		if (err) {
      			console.error(chalk.red('ERROR:'), chalk.yellow(' fileServer error:'+req.url+' : '), err.message);
      		}
      	});
      }
}

/*
function ConvChar( str ) {
  var c = {'<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&#039;', '#':'&#035;' };
  return str.replace( /[<&>'"#]/g, function(s) { return c[s]; } );
}
*/


// Websocket <-> Serial
io.sockets.on('connection', handleConnection);


function handleConnection (socket) { // When we open a WS connection, send the list of ports

  connections.push(socket);

  serialport.list(function (err, ports) {
    socket.emit("ports", ports);
  });

  socket.on('firstload', function(data) {
    socket.emit('config', config);
  });

  socket.on('stop', function(data) {
    socket.emit("connectstatus", 'stopped:'+port.path);
    gcodeQueue.length = 0; // dump the queye
    if (data !== 0) {
      port.write(data+"\n"); // Ui sends the Laser Off command to us if configured, so lets turn laser off before unpausing... Probably safer (;
      console.log('PAUSING:  Sending Laser Off Command as ' + data);
    } else {
      port.write("M5\n");  //  Hopefully M5!
      console.log('PAUSING: NO LASER OFF COMMAND CONFIGURED. PLEASE CHECK THAT BEAM IS OFF!  We tried the detault M5!  Configure your settings please!');
    }
  });

  socket.on('pause', function(data) {
    console.log(chalk.red('PAUSE'));
    if (data !== 0) {
      port.write(data+"\n"); // Ui sends the Laser Off command to us if configured, so lets turn laser off before unpausing... Probably safer (;
      console.log('PAUSING:  Sending Laser Off Command as ' + data);
    } else {
      port.write("M5\n");  //  Hopefully M5!
      console.log('PAUSING: NO LASER OFF COMMAND CONFIGURED. PLEASE CHECK THAT BEAM IS OFF!  We tried the detault M5!  Configure your settings please!');
    }
    socket.emit("connectstatus", 'paused:'+port.path);
    paused = true;
  });

  socket.on('unpause', function(data) {
    socket.emit("connectstatus", 'unpaused:'+port.path);
    paused = false;
    send1Q();
  });

  socket.on('serialsend', function(data) {
    data = data.split('\n');
    for (var i=0; i<data.length; i++) {
      addQ(data[i]);
    }
  });

  socket.on('feedoverride', function(data) {
    if (data === 0) {
      feedOverride = 100;
  	} else {
  	  if ((feedOverride + data <= 200) && (feedOverride + data >= 10)) {
  	    // valid range is 10..200, else ignore!
          feedOverride += data;
  	  }
  	}
  	jumpQ('M220S' + feedOverride);
      for (var i in connections) {   // iterate over the array of connections
        connections[i].emit('feedoverride', feedOverride);
      }
    console.log('Feed Override ' + feedOverride.toString() + '%');
  });

  socket.on('spindleoverride', function(data) {
    if (data === 0) {
      spindleOverride = 100;
  	} else {
  	  if ((spindleOverride + data <= 200) && (spindleOverride + data >= 0)) {
  	    // valid range is 0..200, else ignore!
          spindleOverride += data;
  	  }
  	}
  	jumpQ('M221S' + spindleOverride);
      for (var i in connections) {   // iterate over the array of connections
        connections[i].emit('spindleoverride', spindleOverride);
    }
    console.log('Spindle (Laser) Override ' + spindleOverride.toString() + '%');
  });

  socket.on('lasertest', function(data) { // Laser Test Fire
    data = data.split(',');
    var power = parseInt(data[0]);
    var duration = parseInt(data[1]);
    console.log('laserTest: ', 'Power ' + power + ', Duration ' + duration);
    if (power > 0) {
      if (!laserTestOn) {
        port.write('fire ' + power);
        console.log('Fire ' + power);
        laserTestOn = true;
        if (duration > 0) {
          port.write('G4 P' + duration);
          port.write('fire Off');
          console.log('Fire Off');
          laserTestOn = false;
        }
      } else {
        port.write('fire Off');
        console.log('Fire Off');
        laserTestOn = false;
      }
    }
  });

  // 1 = clear alarm state and resume queueCnt
  // 2 = clear quue, clear alarm state, and wait for new queue
  socket.on('clearalarm', function(data) { // Laser Test Fire
    console.log('Clearing Queue: Method ' + data);
    if (data == "1") {
        console.log('Clearing Lockout');
        port.write("M999\n")
        console.log('Resuming Queue Lockout');
        send1Q();
    } else if (data == "2") {
        console.log('Emptying Queue');
        gcodeQueue.length = 0;
        console.log('Clearing Lockout');
        port.write('M999\n');
    }

  });

  socket.on('getfirmware', function(data) { // Deliver Firmware to Web-Client
    socket.emit("firmware", firmware);
  });

  socket.on('refreshports', function(data) { // Or when asked
    console.log(chalk.yellow('WARN:'), chalk.blue('Requesting Ports Refresh '));
    serialport.list(function (err, ports) {
      socket.emit("ports", ports);
    });
  });

  socket.on('closeport', function(data) { // If a user picks a port to connect to, open a Node SerialPort Instance to it
    console.log(chalk.yellow('WARN:'), chalk.blue('Closing Port ' + port.path));
    socket.emit("connectstatus", 'closed:'+port.path);
    port.close();
  });

  socket.on('arewelive', function(data) { // If a user picks a port to connect to, open a Node SerialPort Instance to it
    socket.broadcast.emit("activePorts", port.path + ',' + port.options.baudRate);
  });


  socket.on('connectto', function(data) { // If a user picks a port to connect to, open a Node SerialPort Instance to it
    data = data.split(',');
    console.log(chalk.yellow('WARN:'), chalk.blue('Connecting to Port ' + data));
    if (!isConnected) {
      port = new SerialPort(data[0], {  parser: serialport.parsers.readline("\n"), baudrate: parseInt(data[1]) });
      socket.emit("connectstatus", 'opening:'+port.path);
      port.on('open', function() {
        socket.broadcast.emit("activePorts", port.path + ',' + port.options.baudRate);
        socket.emit("connectstatus", 'opened:'+port.path);
        // port.write("?\n"); // Lets check if its LasaurGrbl?
        // port.write("M115\n"); // Lets check if its Marlin?
        port.write("version\n"); // Lets check if its Smoothieware?
        // port.write("$fb\n"); // Lets check if its TinyG
        console.log('Connected to ' + port.path + 'at ' + port.options.baudRate);
        isConnected = true;
        connectedTo = port.path;
        queryLoop = setInterval(function() {
          // console.log('StatusChkc')
            port.write('?');
            send1Q();
        }, 200);
        queueCounter = setInterval(function(){
          for (var i in connections) {   // iterate over the array of connections
            connections[i].emit('qCount', gcodeQueue.length);
          }
        }, 500);
        for (var i in connections) {   // iterate over the array of connections
          connections[i].emit("activePorts", port.path + ',' + port.options.baudRate);
        }
      });

      port.on('close', function(err) { // open errors will be emitted as an error event
        clearInterval(queueCounter);
        clearInterval(queryLoop);
        socket.emit("connectstatus", 'closed:'+port.path);
        isConnected = false;
        connectedTo = false;
      });

      port.on('error', function(err) { // open errors will be emitted as an error event
        console.log('Error: ', err.message);
        socket.broadcast.emit("data", data);
      });

      port.on("data", function (data) {
        console.log('Recv: ' + data);
        if(data.indexOf("ok") != -1 || data == "start\r" || data.indexOf('<') == 0){
            if (data.indexOf("ok") == 0) { // Got an OK so we are clear to send
              blocked = false;
            }
            for (var i in connections) {   // iterate over the array of connections
              connections[i].emit("data", data);
            }
            // setTimeout(function(){
              if(paused !== true){
                send1Q();
              } else {
                for (i in connections) {   // iterate over the array of connections
                  connections[i].emit("data", 'paused...');
                }
              }
            //  },1);

         } else {
           for (var i in connections) {   // iterate over the array of connections
             connections[i].emit("data", data);
		   }
         }
      });

    } else {
      socket.emit("connectstatus", 'resume:'+port.path);
      port.write("?\n"); // Lets check if its LasaurGrbl?
      port.write("M115\n"); // Lets check if its Marlin?
      port.write("version\n"); // Lets check if its Smoothieware?
      port.write("$fb\n"); // Lets check if its TinyG
    }
  });

};

// End Websocket <-> Serial



// Queue
function addQ(gcode) {
  gcodeQueue.push(gcode);
}

function jumpQ(gcode) {
  gcodeQueue.unshift(gcode);
}

function send1Q() {
  if (gcodeQueue.length > 0 && !blocked && !paused) {
    var gcode = gcodeQueue.shift();
    // Optimise gcode by stripping spaces - saves a few bytes of serial bandwidth, and formatting commands vs gcode to upper and lowercase as needed
    gcode = gcode.replace(/\s+/g, '');
    console.log('Sent: '  + gcode + ' Q: ' + gcodeQueue.length);
    lastSent = gcode;
    port.write(gcode + '\n');
    blocked = true;
  }
}



// Electron app
const electron = require('electron');
// Module to control application life.
const electronApp = electron.app;

if (electronApp) {
    // Module to create native browser window.
    const BrowserWindow = electron.BrowserWindow;

    // Keep a global reference of the window object, if you don't, the window will
    // be closed automatically when the JavaScript object is garbage collected.
    var mainWindow;

    function createWindow() {
        // Create the browser window.
        mainWindow = new BrowserWindow({width: 800, height: 600, fullscreen: true});

        // and load the index.html of the app.
        mainWindow.loadURL('file://' + __dirname + '/public/index.html');

        // Emitted when the window is closed.
        mainWindow.on('closed', function () {
            // Dereference the window object, usually you would store windows
            // in an array if your app supports multi windows, this is the time
            // when you should delete the corresponding element.
            mainWindow = null;
        });
    };

    electronApp.commandLine.appendSwitch("--ignore-gpu-blacklist");
    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    electronApp.on('ready', createWindow);

    // Quit when all windows are closed.
    electronApp.on('window-all-closed', function () {
        // On OS X it is common for applications and their menu bar
        // to stay active until the user quits explicitly with Cmd + Q
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    electronApp.on('activate', function () {
        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (mainWindow === null) {
            createWindow();
        }
    });
}
