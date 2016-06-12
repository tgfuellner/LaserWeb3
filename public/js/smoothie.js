var queryLoop;
var connectMode;
var scanned, scanok, scanfail;

function initSmoothie() {
  $('#connectVia').change(function() {
    var connectVia = $('#connectVia').val()
    if (connectVia == "USB") {
        connectMode = "USB";
        $('#usbConnect').show();
        $('#ethernetConnect').hide();
        $('#playBtn').show();
        $('#uploadBtn').hide();
    } else if (connectVia == "Ethernet") {
      connectMode = "ETH";
      $('#usbConnect').hide();
      $('#ethernetConnect').show();
      $('#playBtn').hide();
      $('#uploadBtn').show();
    }
  });

  $('.stop-propagation').on('click', function (e) {
    e.stopPropagation();
  });

  $('#scansubnet').on('click', function(e) {
      e.preventDefault();
      e.stopPropagation(); // only neccessary if something above is listening to the (default-)event too
      scanSubnet()
  });

  $('#ethConnect').on('click', function() {
    var smoothieIp = $('#smoothieIp').val();
    localStorage.setItem('smoothieIp', smoothieIp);
    $.ajax({
     type: 'GET',
        url: 'http://' +smoothieIp + '/',
        success: function(data, textStatus, XMLHttpRequest) {
          console.log(data, textStatus, XMLHttpRequest);
          if (textStatus = '200') {
            // alert('Found board at' + ip)
            printLog('Got response from  '+smoothieIp, successcolor)
            isConnected = true;
            $('#ethConnectStatus').html("Ethernet OK")
            $('#syncstatus').html('Eth Connected');
            queryLoop = setInterval(function(){ getStatus() }, 300);
          }
        },
        error: function(XMLHttpRequest, textStatus, errorThrown) {
          $('#ethConnectStatus').html("Connect")
          $('#syncstatus').html('Eth Failed');
        }
    });

  });
};

function scanSubnet() {
  scanned = 254;
  scanok = 0;
  scanfail = 0;
  $("#foundIp").empty();
  var subnet1 = $("#subnet1").val();
  var subnet2 = $("#subnet2").val();
  var subnet3 = $("#subnet3").val();
  if (!subnet1) {
    subnet1 = "192";
  }
  if (!subnet2) {
    subnet2 = "168";
  }
  if (!subnet3) {
    subnet3 = "137";
  }
  var subnet = subnet1 + '.' +  subnet2 + '.' + subnet3 + '.' ;

  for (var ctr = 1; ctr < 255; ctr++) {
    var ip = subnet + ctr
    var result = scanIP(ip)
  }
  localStorage.setItem("subnet1", subnet1);
  localStorage.setItem("subnet2", subnet2);
  localStorage.setItem("subnet3", subnet3);
};

function  scanIP(ip) {
  printLog('Checking: '+ip, successcolor)
  var cmd = "version\n";
  var url = "http://" + ip + "/command";
  // Send the data using post
  var posting = $.post(url, cmd);
  // Put the results in a div
  posting.done(function(data) {
    scanned = scanned - 1;
    scanok += 1
    $("#scannumber").html('Scanning: <span style="color: #00cc00">'+scanok+ '</span>+<span style="color: #cc0000">'+scanfail+ '</span> done. '+scanned+' to go.' )
      $.each(data.split('\n'), function(index) {
        printLog(this, msgcolor)
        var pattern = /Build version: (.*), Build date: (.*), MCU: (.*), System Clock: (.*)/;
         // test the pattern
         var matches = this.match(pattern);
         if (matches) {
             // split branch-hash on dash
             var branchgit = matches[1].split('-');

             var branch = branchgit[0];
             var hash   = branchgit[1];
             var date   = matches[2];
             var mcu    = matches[3];
             var clock  = matches[4];
             $("#foundIp").append("<div class='panel panel-primary'><div class='panel-heading'><h3 class='panel-title'><a onclick='setIP(\""+ip+"\")' href='#'>"+ip+"</a></h3></div><div class='panel-body'>MCU: <kbd>"+mcu+ " @ " + clock + "</kbd><br>FW: <kbd>" + branch + " " + hash + "</kbd><br>FW date: <kbd>" + date + "</kbd></div></div>");
         }
      });
    });
  posting.fail(function(data) {
    scanned = scanned - 1;
    scanfail += 1
    $("#scannumber").html('Scanning: <span style="color: #00cc00">'+scanok+ '</span>+<span style="color: #cc0000">'+scanfail+ '</span> done. '+scanned+' to go.' )
  });
}

function setIP(ipaddr) {
  $("#smoothieIp").val(ipaddr);
}

function runCommand(cmd, silent) {
  var host = $('#smoothieIp').val();
  if (host) {
      // console.log('Connecting Smoothie at ', host);
  } else {
      host = '127.0.0.1'
  }
  cmd += "\n";
  url = silent ? "http://" + host + "/command_silent" : "http://" + host + "/command";
  // Send the data using post
  var posting = $.post(url, cmd);
  // Put the results in console
  if (!silent) {
    posting.done(function(data) {
      $.each(data.split('\n'), function(index) {
        printLog(this, msgcolor)
        console.log(this);
      });
    });
  }
}

function getStatus() {
  var host = $('#smoothieIp').val();
  if (host) {
      // console.log('Connecting Smoothie at ', host);
  } else {
      host = '127.0.0.1'
  }
  // Get some values from elements on the page:
  cmd = "get status\n";
  url = "http://" + host + "/command";
  // Send the data using post
  var posting = $.post(url, cmd);
  posting.done(function(data) {
      $.each(data.split('\n'), function(index) {
          // console.log(this);
          updateStatus(this);
      });
  });
}


function getTemperature() {
  var host = $('#smoothieIp').val();
  var regex_temp = /(B|T(\d*)):\s*([+]?[0-9]*\.?[0-9]+)?/gi;
  //    var test_data = "ok T:23.3 /0.0 @0 T1:23.4 /0.0 @0 B:24.8 /0.0 @0 P:29.4 /0.0 @0";
  var posting = $.post("http://" + host + "/command", "M105\n");
  posting.done(function(data) {
    while ((result = regex_temp.exec(data)) !== null) {
      var tool = result[1];
      var value = result[3];
      if (tool == "T") {
        //$("#heat_actual_t0").html(value + "&deg;C");
      } else if (tool == "T1") {
        //$("#heat_actual_t1").html(value + "&deg;C");
      }
      if (tool == "B") {
        //$("#heat_actual_bed").html(value + "&deg;C");
      }
    }
  });
}