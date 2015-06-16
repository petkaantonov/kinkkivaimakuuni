function busCodeIsIgnored(busCode) {
    return /^(?:53|503)$/.test(busCode);
}

function timetableTableOfTitle(titleNode) {
    var tableCount = 0;
    var node = titleNode;
    while(tableCount < 3) {
        node = node.parentNode;
        if (node.tagName.toLowerCase() === "table") {
            tableCount++;
        }
    }
    return node.querySelectorAll("tbody>tr>td>table:nth-child(2) table.media_width>tbody tr");
}

function parseData(out, rows) {
    [].slice.call(rows).forEach(function(row) {
        var cells = row.querySelectorAll("td");
        var hour = parseInt(cells[0].textContent, 10);
        var stops = out[hour] = {};
        [].slice.call(cells[1].querySelectorAll("div.st_cell")).forEach(function(stop) {
            var minutes = parseInt(stop.querySelector(".stop_small_min").textContent, 10);
            var busCodeText = stop.querySelector(".stop_small_codes").textContent;

            var matches = busCodeText.match(/(\d+[a-z\u00e4\u00f6\u00e5]*)/i);
            if (!matches) return;
            var busCode = matches[1];


            if (/pe$/.test(busCode)) {
                busCode = busCode.slice(0, -2);
            }

            if (!busCodeIsIgnored(busCode)) {
                stops[minutes] = busCode;
            }
        });
    });
};


function parseTimetableData(rawHtml) {
    var doc = document.implementation.createHTMLDocument("title");
    doc.body.innerHTML = rawHtml;
    var ret = {
        weekday: {},
        saturday: {},
        sunday: {},
        lastFetch: Date.now()
    }
    var titles = doc.querySelectorAll(".stoptitle1");
    parseData(ret.weekday, timetableTableOfTitle(titles[0]));
    parseData(ret.saturday, timetableTableOfTitle(titles[1]));
    parseData(ret.sunday, timetableTableOfTitle(titles[2]));
    return ret;
}

var corsProviders = [
    function(url) {
        return "http://crossorigin.me/" + url
    }
];

function Stop(name, id, url) {
    this.name = name;
    this.id = id;
    this.url = url;
    this.timetables = null;
}

Stop.prototype.fetchTimetables = function() {
    var self = this;
    return new Promise(function(resolve, reject) {
        var item = localStorage.getItem("stopdata-" + self.id);
        if (item) {
            item = JSON.parse(item);
            if (Date.now() - item.lastFetch < 86400 * 1000) {
                return resolve(item);
            }
        }

        resolve((function corsLoop(index) {
            return new Promise(function(resolve, reject) {
                var corsProvider = corsProviders[index];
                var xhr = new XMLHttpRequest();

                xhr.open("GET", corsProvider(self.url));
                xhr.addEventListener("error", reject, false);
                xhr.addEventListener("abort", reject, false);
                xhr.addEventListener("load", function() {
                    try {
                        if (xhr.status !== 200) {
                            reject(new Error(xhr.responseText));
                        } else {
                            var result = parseTimetableData(xhr.responseText);
                            localStorage.setItem("stopdata-" + self.id, JSON.stringify(result));
                            resolve(result);
                        }
                    } catch (e) {
                        reject(e);

                    }
                }, false);
                xhr.send(null);

            }).catch(function(e) {
                if (index + 1 < corsProviders.length) {
                    return corsLoop(index + 1);
                }
                throw e;
            });
        })(0));
    }).then(function(result) {
        self.timetables = result;
        return self;
    });
};

Stop.prototype.get24HourTimetables = function(date) {
    var dayType = dayToDayType[date.getUTCDay()];
    var rawTable = this.timetables[dayType];
    var copy = new Date(+date);
    copy.setUTCHours(0);
    copy.setUTCMinutes(0);
    copy.setUTCSeconds(0);
    copy.setUTCMilliseconds(0);

    var ret = [];
    var now = currentFinnishDate();

    Object.keys(rawTable).forEach(function(hour) {
        var minuteTables = rawTable[hour];
        Object.keys(minuteTables).forEach(function(minute) {
            var busCode = minuteTables[minute];

            var busArrivalTimestamp = (+copy + (+hour * 60 * 60 * 1000) + (+minute * 60 * 1000));

            if ((busArrivalTimestamp + 59 * 1000) < now) {
                return;
            }

            ret.push({
                busArrivalTimestamp: busArrivalTimestamp,
                busCode: busCode,
                source: this.name
            });
        }, this);
    }, this);

    return ret;
};

Stop.prototype.getSufficientTimetables = function() {
    var today = currentFinnishDate();
    var tomorrow = new Date(+currentFinnishDate() + 86400 * 1000);

    var first = this.get24HourTimetables(today);
    var second = this.get24HourTimetables(tomorrow);

    return first.concat(second);
};

function getBusArrivals() {
    var ret = [];

    for (var i = 0; i < arguments.length; ++i) {
        var stop = arguments[i];
        var stopTimetables = stop.getSufficientTimetables();
        for (var j = 0; j < stopTimetables.length; ++j) {
            ret.push(stopTimetables[j]);
        }
    }

    return ret.sort(function(a, b) {
        return a.busArrivalTimestamp - b.busArrivalTimestamp;
    });
}


var finnishTzOffset = (function() {
    var dstOffsetMap = Object.create(null);
    dstOffsetMap[Date.UTC(2015, 2, 29, 1)] = 0;
    dstOffsetMap[Date.UTC(2015, 9, 25, 0)] = 1;
    dstOffsetMap[Date.UTC(2016, 2, 27, 1)] = 0;
    dstOffsetMap[Date.UTC(2016, 9, 30, 0)] = 1;
    dstOffsetMap[Date.UTC(2017, 2, 26, 1)] = 0;
    dstOffsetMap[Date.UTC(2017, 9, 29, 0)] = 1;
    dstOffsetMap[Date.UTC(2018, 2, 25, 1)] = 0;
    dstOffsetMap[Date.UTC(2018, 9, 28, 0)] = 1;
    dstOffsetMap[Date.UTC(2019, 2, 31, 1)] = 0;
    dstOffsetMap[Date.UTC(2019, 9, 27, 0)] = 1;
    dstOffsetMap[Date.UTC(2020, 2, 29, 1)] = 0;
    dstOffsetMap[Date.UTC(2020, 9, 25, 0)] = 1;
    dstOffsetMap[Date.UTC(2021, 2, 28, 1)] = 0;
    dstOffsetMap[Date.UTC(2021, 9, 31, 0)] = 1;
    dstOffsetMap[Date.UTC(2022, 2, 27, 1)] = 0;
    dstOffsetMap[Date.UTC(2022, 9, 30, 0)] = 1;
    dstOffsetMap[Date.UTC(2023, 2, 26, 1)] = 0;
    dstOffsetMap[Date.UTC(2023, 9, 29, 0)] = 1;
    dstOffsetMap[Date.UTC(2024, 2, 31, 1)] = 0;
    dstOffsetMap[Date.UTC(2024, 9, 27, 0)] = 1;
    dstOffsetMap[Date.UTC(2025, 2, 30, 1)] = 0;
    dstOffsetMap[Date.UTC(2025, 9, 26, 0)] = 1;
    dstOffsetMap[Date.UTC(2026, 2, 29, 1)] = 0;
    dstOffsetMap[Date.UTC(2026, 9, 25, 0)] = 1;
    dstOffsetMap[Date.UTC(2027, 2, 28, 1)] = 0;
    dstOffsetMap[Date.UTC(2027, 9, 31, 0)] = 1;
    dstOffsetMap[Date.UTC(2028, 2, 26, 1)] = 0;
    dstOffsetMap[Date.UTC(2028, 9, 29, 0)] = 1;
    dstOffsetMap[Date.UTC(2029, 2, 25, 1)] = 0;
    dstOffsetMap[Date.UTC(2029, 9, 28, 0)] = 1;
    dstOffsetMap[Date.UTC(2030, 2, 31, 1)] = 0;
    dstOffsetMap[Date.UTC(2030, 9, 27, 0)] = 1;
    dstOffsetMap[Date.UTC(2031, 2, 30, 1)] = 0;
    dstOffsetMap[Date.UTC(2031, 9, 26, 0)] = 1;
    dstOffsetMap[Date.UTC(2032, 2, 28, 1)] = 0;
    dstOffsetMap[Date.UTC(2032, 9, 31, 0)] = 1;
    dstOffsetMap[Date.UTC(2033, 2, 27, 1)] = 0;
    dstOffsetMap[Date.UTC(2033, 9, 30, 0)] = 1;
    dstOffsetMap[Date.UTC(2034, 2, 26, 1)] = 0;
    dstOffsetMap[Date.UTC(2034, 9, 29, 0)] = 1;
    dstOffsetMap[Date.UTC(2035, 2, 25, 1)] = 0;
    dstOffsetMap[Date.UTC(2035, 9, 28, 0)] = 1;
    dstOffsetMap[Date.UTC(2036, 2, 30, 1)] = 0;
    dstOffsetMap[Date.UTC(2036, 9, 26, 0)] = 1;
    dstOffsetMap[Date.UTC(2037, 2, 29, 1)] = 0;
    dstOffsetMap[Date.UTC(2037, 9, 25, 0)] = 1;



    var dstSwitchPoints = Object.keys(dstOffsetMap).map(Number).sort(function(a, b) {
        return a - b;
    });

    return function() {
        var now = Date.now();

        var dstOffset = NaN;
        for (var i = 0; i < dstSwitchPoints.length; ++i) {
            var dstSwitchPoint = dstSwitchPoints[i];
            if (now < dstSwitchPoint) {
                dstOffset = dstOffsetMap[dstSwitchPoint];
                break;
            }
        }

        return (dstOffset + 2);
    };
})();

function finnishTzOffsetMs() {
    return finnishTzOffset() * 60 * 60 * 1000;
}

// Returns a date object where UTC* methods return finnish dates
// the local methods cannot be used as they are reliant on the machine tz
function currentFinnishDate() {
    var now = Date.now();
    return new Date(now + finnishTzOffsetMs());
}

function finnishDate(timestamp) {
    return new Date(timestamp + finnishTzOffset());
}

function hideSpinner() {
    document.querySelector("#spinner-container").style.display = "none";
}

function showError(e) {
    document.querySelector("#error-container").style.display = "block";
}

var prevBest;
function renderUi() {
    try {
        var now = Date.now() - 60 * 1000;
        var busArrivals = getBusArrivals(kinkki, makuuni);

        var topCurrentArrivals = busArrivals.sort(function(a, b) {
            var aDelta = Math.abs(a.busArrivalTimestamp - now);
            var bDelta = Math.abs(b.busArrivalTimestamp - now);
            return aDelta - bDelta;
        }).slice(0, 10);

        var best = topCurrentArrivals[0];

        if (!prevBest || prevBest.busArrivalTimestamp !== best.busArrivalTimestamp) {
            var className = "solution " + best.source.toLowerCase();
            var elem = document.querySelector("#solution");
            elem.className = className;
            elem.textContent = best.source;
            document.querySelector("#more-info-table").innerHTML = renderTable(topCurrentArrivals);
        }
        prevBest = best;
    } finally {
        setTimeout(renderUi, 1000);
    }
}

function getArrivalFormattingData(deltaMinutes) {
    var className = "neutral-delta";

    if (deltaMinutes < 0) {
        className = "negative-delta";
    } else if (deltaMinutes > 0) {
        className = "positive-delta";
    }

    className += " arrival-delta-amount";

    var minutesAmountText;
    if (deltaMinutes > 0) {
        minutesAmountText = "+" + deltaMinutes;
    } else {
        minutesAmountText = deltaMinutes + "";
    }

    var minutesText = deltaMinutes === 1 || deltaMinutes === -1 ? "minuutti" : "minuuttia";
    return {
        minutesText: minutesText,
        deltaClassName: className,
        minutesAmountText: minutesAmountText
    }
}

function renderTable(results) {
    var now = +currentFinnishDate();
    var ret = '<table class="extra-info-table table table-condensed">\n\
      <thead>\n\
        <tr>\n\
          <th>Saapuu</th>\n\
          <th>Linja</th>\n\
          <th>Pysäkki</th>\n\
        </tr>\n\
      </thead>\n\
      <tbody>';

    results.forEach(function(result) {
        var ts = result.busArrivalTimestamp;
        var deltaMinutes = Math.round((ts - now) / 1000 / 60);
        var arrivalFormattingData = getArrivalFormattingData(deltaMinutes);


        ret += '<tr>';
        ret += '<td><div class="arrival-time-container" data-timestamp="'+ts+'">'+
                    '<span class="'+arrivalFormattingData.deltaClassName +
                    '">'+arrivalFormattingData.minutesAmountText+'</span> <span class="arrival-minutes-text">'+
                    arrivalFormattingData.minutesText+'</span></div></td>';
        ret += '<td><span class="buscode">' + result.busCode + '</span></td>';
        ret += '<td><span class="stop '+result.source.toLowerCase()+'">'+result.source+'</span></td>';
        ret += '</tr>';
    });

    ret += '</tbody></table>';
    return ret;
}

setInterval(function() {
    var res = document.querySelectorAll(".arrival-time-container");
    var now = +currentFinnishDate();

    for (var i = 0; i < res.length; ++i) {
        var elem = res[i];
        var ts = parseInt(elem.getAttribute("data-timestamp"), 10);
        var deltaMinutes = Math.round((ts - now) / 1000 / 60);
        var arrivalFormattingData = getArrivalFormattingData(deltaMinutes);

        var amountContainer = elem.querySelector(".arrival-delta-amount");
        var textContainer = elem.querySelector(".arrival-minutes-text");

        amountContainer.className = arrivalFormattingData.deltaClassName;
        amountContainer.textContent = arrivalFormattingData.minutesAmountText;
        textContainer.textContent = arrivalFormattingData.minutesText;
    }
}, 1000);

var DAYTYPE = {
    WEEKDAY: "weekday",
    SATURDAY: "saturday",
    SUNDAY: "sunday"
};

var dayToDayType = [
    DAYTYPE.SUNDAY,
    DAYTYPE.WEEKDAY,
    DAYTYPE.WEEKDAY,
    DAYTYPE.WEEKDAY,
    DAYTYPE.WEEKDAY,
    DAYTYPE.WEEKDAY,
    DAYTYPE.SATURDAY
];

var kinkki = new Stop("Kinkki", 1318, "http://aikataulut.reittiopas.fi/pysakit/fi/1140106.html");
var makuuni = new Stop("Makuuni", 1316, "http://aikataulut.reittiopas.fi/pysakit/fi/1140105.html");

Promise.all([kinkki.fetchTimetables(), makuuni.fetchTimetables()]).then(renderUi).then(hideSpinner).catch(function(e) {
    hideSpinner();
    showError(e);
})
