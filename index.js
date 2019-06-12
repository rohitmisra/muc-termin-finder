'use strict';
var request = require("request");
var cookieJar = request.jar()
const req = request.defaults({jar: cookieJar});
var formData = {};
formData['CASETYPES[Familienstandsänderung/ Namensänderung]'] = 2;
formData['step'] = 'WEB_APPOINT_SEARCH_BY_CASETYPES';

var headersData = {
    'Accept': 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded'
  };

var sessionOptions = {
    url: 'https://www56.muenchen.de/termin/index.php?loc=BB',
    jar: cookieJar
};

var terminOptions = { method: 'POST',
  followAllRedirects: true,
  url: 'https://www56.muenchen.de/termin/index.php?loc=BB',
  headers: headersData,
  formData: formData,
  jar: cookieJar
};

req.post(terminOptions, function(){
  req.post(terminOptions, function (error, response, body) {
    if (error) throw new Error(error);
      var jsonAppoints = parseResponseBody(body);
      findNextAppointment(jsonAppoints);
  });
});

var parseResponseBody = function (body){
  var scriptTagRegex = new RegExp(/jsonAppoints(.*?);/gi);
    var textToTest =  body;
    var obj = scriptTagRegex.exec(textToTest);
    return JSON.parse(obj[0].substring(16,obj[0].length-2))
}

var findNextAppointment = function (jsonAppoints){
  var availAppoints = {};
  for(var loc in jsonAppoints){
    var availAppointsInLoc = {}; 
    for(var dateTag in jsonAppoints[loc].appoints){
      for(var slot in jsonAppoints[loc].appoints[dateTag]){
        if(!(dateTag in availAppointsInLoc)){
          availAppointsInLoc[dateTag] = new Array();
        }
        availAppointsInLoc[dateTag].push(jsonAppoints[loc].appoints[dateTag][slot])
      }
    }
    availAppoints[jsonAppoints[loc].caption] = availAppointsInLoc;
  }
  console.log(JSON.stringify(availAppoints, null, 3));
}




