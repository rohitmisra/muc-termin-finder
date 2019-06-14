'use strict';
var request = require("request");
var cookieJar = request.jar()
const req = request.defaults({ jar: cookieJar });


var formData = {
  step: 'WEB_APPOINT_SEARCH_BY_CASETYPES',
  'CASETYPES[An- oder Ummeldung - Einzelperson]': '0',
  'CASETYPES[An- oder Ummeldung - Einzelperson mit eigenen Fahrzeugen]': '0',
  'CASETYPES[An- oder Ummeldung - Familie]': '0',
  'CASETYPES[An- oder Ummeldung - Familie mit eigenen Fahrzeugen]': '0',
  'CASETYPES[Familienstandsänderung/ Namensänderung]': '2',
  'CASETYPES[Eintragung Übermittlungssperre]': '0',
  'CASETYPES[Meldebescheinigung]': '0',
  'CASETYPES[Haushaltsbescheinigung]': '0',
  'CASETYPES[Melderegisterauskunft]': '0',
  'CASETYPES[Abmeldung (Einzelperson oder Familie)]': '0',
  'CASETYPES[Antrag Personalausweis]': '0',
  'CASETYPES[Antrag Reisepass/Expressreisepass]': '0',
  'CASETYPES[Antrag vorläufiger Reisepass]': '0',
  'CASETYPES[Antrag oder Verlängerung/Aktualisierung Kinderreisepass]': '0',
  'CASETYPES[Ausweisdokumente - Familie (Minderjährige und deren gesetzliche Vertreter)]': '0',
  'CASETYPES[Nachträgliche Anschriftenänderung Personalausweis/Reisepass/eAT]': '0',
  'CASETYPES[Nachträgliches Einschalten eID / Nachträgliche Änderung PIN]': '0',
  'CASETYPES[Widerruf der Verlust- oder Diebstahlanzeige von Personalausweis oder Reisepass]': '0',
  'CASETYPES[Verlust- oder Diebstahlanzeige von Personalausweis]': '0',
  'CASETYPES[Verlust- oder Diebstahlanzeige von Reisepass]': '0',
  'CASETYPES[Gewerbeummeldung (Adressänderung innerhalb Münchens)]': '0',
  'CASETYPES[Gewerbeabmeldung]': '0',
  'CASETYPES[Führungszeugnis beantragen]': '0',
  'CASETYPES[Gewerbezentralregisterauskunft beantragen – natürliche Person]': '0',
  'CASETYPES[Gewerbezentralregisterauskunft beantragen – juristische Person]': '0',
  'CASETYPES[Bis zu 5 Beglaubigungen Unterschrift]': '0',
  'CASETYPES[Bis zu 5 Beglaubigungen Dokument]': '0',
  'CASETYPES[Bis zu 20 Beglaubigungen]': '0',
  'CASETYPES[Fabrikneues Fahrzeug anmelden (mit deutschen Fahrzeugpapieren und CoC)]': '0',
  'CASETYPES[Fahrzeug wieder anmelden]': '0',
  'CASETYPES[Fahrzeug umschreiben von außerhalb nach München]': '0',
  'CASETYPES[Fahrzeug umschreiben innerhalb Münchens]': '0',
  'CASETYPES[Fahrzeug außer Betrieb setzen]': '0',
  'CASETYPES[Saisonkennzeichen beantragen]': '0',
  'CASETYPES[Kurzzeitkennzeichen beantragen]': '0',
  'CASETYPES[Umweltplakette/ Feinstaubplakette für Umweltzone beantragen]': '0',
  'CASETYPES[Adressänderung in Fahrzeugpapiere eintragen lassen]': '0',
  'CASETYPES[Namensänderung in Fahrzeugpapiere eintragen lassen]': '0',
  'CASETYPES[Verlust oder Diebstahl der Zulassungsbescheinigung Teil I]': '0'
};

var headersData = {
  'Accept': 'application/json',
  'Content-Type': 'application/x-www-form-urlencoded'
};

var sessionOptionsCentral = {
  url: 'https://www12.muenchen.de/termin/index.php?cts=10224134=2',
  jar: cookieJar
};

var sessionOptionsOthers = {
  url: 'https://www56.muenchen.de/termin/index.php?loc=BB',
  jar: cookieJar
};

var terminOptionsCentral = {
  method: 'POST',
  followAllRedirects: true,
  url: 'https://www12.muenchen.de/termin/index.php?cts=10224134=2',
  headers: headersData,
  formData: formData,
  jar: cookieJar
};

var terminOptionsOthers = {
  method: 'POST',
  followAllRedirects: true,
  url: 'https://www56.muenchen.de/termin/index.php?loc=BB',
  headers: headersData,
  formData: formData,
  jar: cookieJar
};

req.post(sessionOptionsCentral, function () {
  req.post(terminOptionsCentral, function (error, response, body) {
    if (error) throw new Error(error);
    var jsonAppoints = parseResponseBodyCentral(body);
    findAppointments(jsonAppoints);
    req.post(sessionOptionsOthers, function (error, response, body) {
      req.post(terminOptionsOthers, function (error, response, body) {
        if (error) throw new Error(error);
        var jsonAppoints = parseResponseBodyOthers(body);
        findAppointments(jsonAppoints);
      });
    });
  });
});

var parseResponseBodyCentral = function (body) {
  var scriptTagRegex = new RegExp(/jsonAppoints(.*?);/gi);
  var textToTest = body;
  var obj = scriptTagRegex.exec(textToTest);
  return JSON.parse(obj[0].substring(16, obj[0].length - 2))
}

var parseResponseBodyOthers = function (body) {
  var scriptTagRegex = new RegExp(/jsonAppoints(.*?);/gi);
  var textToTest = body;
  var obj = scriptTagRegex.exec(textToTest);
  return JSON.parse(obj[0].substring(16, obj[0].length - 2))
}

var findAppointments = function (jsonAppoints) {
  var availAppoints = {};
  for (var loc in jsonAppoints) {
    var availAppointsInLoc = {};
    for (var dateTag in jsonAppoints[loc].appoints) {
      for (var slot in jsonAppoints[loc].appoints[dateTag]) {
        var dateLabel = new Date(dateTag).toDateString();
        if (!(dateLabel in availAppointsInLoc)) {
          availAppointsInLoc[dateLabel] = new Array();
        }
        availAppointsInLoc[dateLabel].push(jsonAppoints[loc].appoints[dateTag][slot]);
      }
    }
    availAppoints[jsonAppoints[loc].caption] = availAppointsInLoc;
  }
  //console.log(JSON.stringify(availAppoints, null, 3));
  prettyPrintAppointments(availAppoints);
}

var prettyPrintAppointments = function(availAppoints){
  var printString = "";
  for(var loc in availAppoints){
    printString += loc + ": \n\n";
    for(var dateLabel in availAppoints[loc]){
      var timesArr = [];
      for(var timeLabel in availAppoints[loc][dateLabel]){
        timesArr.push(availAppoints[loc][dateLabel][timeLabel]);
      }
      if(timesArr.length > 0){
        printString += ' ' + dateLabel + ': \n  ' + timesArr.join(', ') + '\n\n';
      }
    }
    printString += '\n\n';
  }
  console.log(printString);
};