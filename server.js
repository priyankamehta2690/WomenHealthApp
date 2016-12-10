var knex = require('knex')({
    client: 'mysql',
    connection: {
        host     : 'localhost',
        user     : 'root',
        password : 'bazzinga',
        database : 'bingeeatingdb',
        charset  : 'utf8'
  }
});

var express = require("express");
var Bookshelf = require('bookshelf')(knex);
var uuid = require('uuid');
var bodyParser = require('body-parser');
var jwt    = require('jsonwebtoken');
var push = require('./modelObject');
var crypto = require('crypto');
var cron = require('node-cron');
var cors = require('cors');
// var apn = require('apn');
//
// var options = {
//     cert: 'keys/binge-certificate.pem',
//     key: 'keys/key.pem',
//     passphrase: 'bazzinga',
//     production: false,
//     connectionTimeout: 10000
// };
//
// var apnProvider = new apn.Provider(options);

var app = express();

app.use(require('morgan')('dev'));

var session = require('express-session');

var FileStore = require('session-file-store')(session);

app.use(session({
    name: 'server-session-cookie-id',
    secret: 'binge secret',
    saveUninitialized: true,
    resave: true,
    store: new FileStore()
}));

var JWTKEY = 'BingeEating'; // Key for Json Web Token

// body-parser middleware for handling request variables
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(cors());

//to render images
app.use(express.static(__dirname + '/views'))

app.set('view engine', 'ejs');

var User = Bookshelf.Model.extend({
    tableName: 'users'
});

var DailySummary = Bookshelf.Model.extend({
   tableName: 'dailysummarysheet'
});

var PhysicalDailySummary = Bookshelf.Model.extend({
    tableName: 'physicaldailysummary'
});

var WeeklySummary = Bookshelf.Model.extend({
    tableName: 'weeklysummarysheet'
});

var Appointments = Bookshelf.Model.extend({
    tableName: 'appointments'
});

app.get('/', function(req, res) {
   res.sendFile(__dirname + '/views/pages/home.html');
});

app.use(function (req, res, next) {

    // Website you wish to allow to connect
    res.setHeader('Access-Control-Allow-Origin',"*");
    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

    // Request headers you wish to allow
    res.setHeader("Access-Control-Allow-Headers", "*");

    res.setHeader('Access-Control-Expose-Headers','*');

    // Pass to next layer of middleware
    next();
});

// function sendPushForDevice(withToken, pushMessage, callback){
//     //Sending push...
//     var note = new apn.Notification();
//
//     note.expiry = pushMessage.expiry;
//     note.badge = pushMessage.badge;
//     note.sound = pushMessage.sound;
//     note.alert = pushMessage.alert;
//     note.payload = pushMessage.payload;
//
//     apnProvider.send(note, withToken)
//         .then(function (result) {
//             console.log(result)
//         });
//     callback();
//     //Push ends here ...
// }
// //
// app.post('/push', function(req, res){
//     var alertMessage = {'message': 'You have an appointment coming up at '};
//     var pushMessage = new push.PushMessage(alertMessage);
//     sendPushForDevice('7B77DF4540BAAAB8F96B2C64250F7ADE25A5509E0762482BA7B235A03FF787F4', pushMessage, function() {
//         res.json({error: false, data: {message: 'Push sent!'}});
//     });
// });

app.post('/login', function(req, res){
    var username = req.body.username;
    var password = req.body.password;
    User.forge({username: username, password: password})
        .fetch()
        .then(function (user){
            if (!user) {
                res.json({error: true, data: {message: "Invalid credentials"}});
            }else {
                // var userPassword = sha512(password, user.attributes.Salt);
                // if (userPassword == user.attributes.HashedPassword) {
                    var token = jwt.sign(user, JWTKEY, {
                        expiresIn: 900 //The token expries in 15 minutes
                    });
                    req.session.user = user.attributes;
                    if (req.session.user.Role == 'Supporter' || req.session.user.Role == 'Admin') {
                        knex('activity').innerJoin('users', 'activity.UserId', 'users.UserId')
                            .where('users.SupporterId', req.session.user.UserId)
                            .andWhereBetween('activity.ActivityDateTime', [new Date() - 1, new Date()])
                            .then(function (activities) {
                                res.send({error: false, token: token, data: {activities: activities}});
                            })
                            .catch(function (err) {
                                res.send({error: true, data: {message: err.message}});
                            })
                    }
                    else {
                        res.send({
                            error: true,
                            data: {message: 'Oops! Only supporters can login using the web portal!'}
                        });
                    }
                // }
                // else {
                //     res.send({error: true, data: {message: 'Invalid Password'}});
                // }
            }
        })
        .catch(function (err) {
            res.send({error: true, data: {message: err.message}});
        });
});

var genRandomString = function(length){
    return crypto.randomBytes(Math.ceil(length/2))
        .toString('hex') /** convert to hexadecimal format */
        .slice(0,length);   /** return required number of characters */
};

var sha512 = function(password, salt){
    var hash = crypto.createHmac('sha512', salt);
    hash.update(password);
    var value = hash.digest('hex');
    return value;
};


app.post('/getNewsFeed', function (req, res) {
    var decoded = jwt.verify(req.body.token, JWTKEY);
    if(decoded) {
        if(!req.session.user) {
            req.session.user = decoded.attributes;
        }
        if (req.session.user.Role == 'Supporter' || req.session.user.Role == 'Admin') {
            knex('activity').innerJoin('users', 'activity.UserId', 'users.UserId')
                .where('users.SupporterId', req.session.user.UserId)
                .then(function (activities) {
                    res.send({error: false, data: {activities: activities}});
                })
                .catch(function (err) {
                    res.send({error: true, data: {message: err.message}});
                })

        } else {
            res.send({error: true, data: {message: 'Participants cannot login using web portal!'}});
        }
    }
    else {
         res.send({error: true, data: {message: 'invalid token'}});
    }
});


app.post('/signin', function(req, res){
    var username = req.body.username;
    var password = req.body.password;
    User.forge({username: username, password: password})
        .fetch()
        .then(function (user){
            if (!user) {
                res.status(401).json({error: true, data: {message: "Invalid user credentials"}});
            }else {
                // var userPassword = sha512(password, user.attributes.Salt);
                // if (userPassword == user.attributes.HashedPassword) {
                    var token = jwt.sign(user, JWTKEY, {
                        expiresIn: 900 //The token expries in 15 minutes
                    });
                    if (user.attributes.Role == 'Participant') {
                        req.session.user = user.attributes;
                        res.status(200).json({error: false, data: {token: token}});
                    }
                    else {
                        res.json(401).json({
                            error: true,
                            data: {message: 'Oops! Only participants can login using the mobile application!'}
                        });
                    }
                // }
                // else {
                //     res.send({error: true, data: {message: 'Invalid Password'}});
                // }
            }
        })
        .catch(function (err) {
            res.status(500).json({error: true, data: {message: err.message}});
        });
});

app.post('/postDailyLog', function (req, res) {
    var decoded = jwt.verify(req.body.token, JWTKEY);
    if(decoded) {
        var LogId = '';
        if (req.body.logId == '') {
            LogId = uuid.v1();
        } else {
            LogId = req.body.logId;
        }
        knex('dailysummarysheet')
            .insert({
                LogId: LogId,
                UserId: req.session.user.UserId,
                Time: req.body.time,
                FoodOrDrinkConsumed: req.body.consumed,
                FVNumberOfServings: req.body.servings,
                Binge: req.body.binge,
                VomitingOrLaxative: req.body.vl,
                ContextOrSetting: req.body.cs,
                Feelings: req.body.feelings
            })
            .then(function (count) {
                knex('activity')
                    .insert({
                        Id: uuid.v1(),
                        UserId: req.session.user.UserId,
                        Activity: 'Daily Log',
                        ActivityDateTime: new Date()
                    })
                    .then(function (count) {
                        res.status(200).json({error: false, data: {logs: dailyLogs}});
                    })
                    .catch(function (err) {
                        res.status(500).json({error: true, data: {message: err.message}});
                    });
            })
            .catch(function (err) {
                res.status(500).json({error: true, data: {message: err.message}});
            });
    }else {
        res.status(401).json({error: true, data: {message: 'invalid token'}});
    }
});

app.post('/postPhysicalDailyLog', function (req, res) {
    var decoded = jwt.verify(req.body.token, JWTKEY);
    if(decoded){
        var dailyLogs = [];
        var data = JSON.parse(req.body.data);
        for (var i = 0; i < data.length; i++) {
            dailyLogs.push({
                LogId: uuid.v1(),
                UserId: req.session.user.UserId,
                Time: data[i].time,
                PhysicalActivity: data[i].workout,
                MinutesPerformed: data[i].minutes
            });
        }
        knex('physicaldailysummary')
            .insert(dailyLogs)
            .then( function (count) {
                knex('activity')
                    .insert({
                        Id: uuid.v1(),
                        UserId: req.session.user.UserId,
                        Activity: 'Daily Physical Log',
                        ActivityDateTime: new Date()
                    })
                    .then( function (count) {
                        res.status(200).json({error: false, data: {logs: dailyLogs}});
                    })
                    .catch( function (err) {
                        res.status(500).json({error: true, data: {message: err.message}});
                    });
            })
            .catch( function (err) {
                res.status(500).json({error: true, data: {message: err.message}});
            });
    }else {
        res.status(401).json({error: true, data: {message: 'invalid token'}});
    }
});

app.post('/getDailyLog', function (req, res) {
    var decoded = jwt.verify(req.body.token, JWTKEY);
    if(decoded){
        if(!req.session.user) {
            req.session.user = decoded.attributes;
        }
        var Id = '';
        if(req.session.user.Role == 'Supporter' || req.session.user.Role == 'Admin') {
            Id = req.body.userId;
        }
        else {
            Id = req.session.user.UserId;
        }
        var startTime = req.body.date + ' 00:00:00';
        var endTime = req.body.date + ' 23:59:59';
        knex.from('dailysummarysheet')
            .whereBetween('Time', [startTime, endTime])
            .andWhere('UserId', Id)
            .then(function(dailyLogs) {
                if(req.session.Role == 'Supporter' || req.session.Role == 'Admin') {
                    res.send({error: false, data: {dailyLogs: dailyLogs}});
                }
                else {
                    res.status(200).json({error: false, data: {dailyLogs: dailyLogs}});
                }

            })
            .catch(function (err){
                res.status(500).send({error: true, data: {message: err.message}});
            })
    }else {
        res.status(401).send({error: true, data: {message: 'invalid token'}});
    }
});

app.post('/getPhysicalDailyLog', function (req, res) {
    var decoded = jwt.verify(req.body.token, JWTKEY);
    if(decoded){
        if(!req.session.user) {
            req.session.user = decoded.attributes;
        }
        var Id = '';
        if(req.session.user.Role == 'Supporter' || req.session.user.Role == 'Admin') {
            Id = req.body.userId;
        }
        else {
            Id = req.session.user.UserId;
        }
        var startTime = req.body.date + ' 00:00:00';
        var endTime = req.body.date + ' 23:59:59';
        knex.from('physicaldailysummary')
            .whereBetween('Time', [startTime, endTime])
            .andWhere('UserId', Id)
            .then(function(dailyLogs) {
                if(req.session.Role == 'Supporter' || req.session.Role == 'Admin') {
                    res.send({error: false, data: {dailyLogs: dailyLogs}});
                }
                else {
                    res.status(200).json({error: false, data: {dailyLogs: dailyLogs}});
                }

            })
            .catch(function (err){
                res.status(500).send({error: true, data: {message: err.message}});
            })
    }else {
        res.status(401).send({error: true, data: {message: 'invalid token'}});
    }
});

app.post('/getNewWeeklyLog', function (req, res) {
    var decoded = jwt.verify(req.body.token, JWTKEY);
    if(decoded){
        var lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);
        knex.from('dailysummarysheet')
            .where('Time', '>', lastWeek)
            .andWhere('UserId', req.session.user.UserId)
            .then(function(dailyLogs) {
                var binges = 0;
                var vld = 0;
                for (var i = 0; i < dailyLogs.length; i++) {
                    if(dailyLogs[i].Binge == 1) {
                        binges++;
                    }
                    if(dailyLogs[i].VomitingOrLaxative == 1) {
                        vld++;
                    }
                }
                knex('physicaldailysummary').count('LogId as count')
                    .where('MinutesPerformed', '>', 30)
                    .andWhere('UserId', req.session.user.UserId)
                    .andWhere('Time','>', lastWeek)
                    .then(function(count) {
                        WeeklySummary.forge({
                            LogId: uuid.v1(),
                            UserId: req.session.user.UserId,
                            week: req.body.week,
                            Binges: binges,
                            VLD: vld,
                            PhysicalActivity: count[0].count,
                            CreatedDateTime: new Date()
                        }).save(null, {method: 'insert'})
                            .then(function (weeklyLog) {
                                res.status(200).json({error: false, data: {weeklyLog: weeklyLog}});
                            })
                            .catch(function (err) {
                                res.status(500).json({error: true, data: {message: err.message}});
                            });
                    })
                    .catch(function (err){
                        res.status(500).json({error: true, data: {message: err.message}});
                    })
            })
            .catch(function (err){
                res.status(500).json({error: true, data: {message: err.message}});
            })
    }else {
        res.status(401).json({error: true, data: {message: 'invalid token'}});
    }
});

app.post('/getWeeklyLog', function (req, res) {
    var decoded = jwt.verify(req.body.token, JWTKEY);
    if(decoded) {
        var Id = '';
        var week = [];
        if(!req.session.user) {
            req.session.user = decoded.attributes;
        }
        if(req.session.user.Role == 'Supporter' || req.session.user.Role == 'Admin') {
            Id = req.body.userId;
            week.push(req.body.week);
        } else {
            Id = req.session.user.UserId;
            for(var i = 1; i < 9; i++) {
                week.push(i);
            }
        }
        knex('weeklysummarysheet')
            .whereIn('Week', week)
            .andWhere('UserId', Id)
            .then(function (weeklyLog) {
                if (req.session.Role == 'Supporter' || req.session.Role == 'Admin') {
                    res.send({error: false, data: {weeklyLog: weeklyLog}});
                }
                else {
                    res.status(200).json({error: false, data: {weeklyLog: weeklyLog}});
                }
            })
            .catch(function (err) {
                if (req.session.Role == 'Supporter' || req.session.Role == 'Admin') {
                    res.send({error: true, data: {message: err.message}});
                }
                else {
                    res.status(200).json({error: false, data: {message: err.message}});
                }
            })
    }else {
        if (req.session.Role == 'Participant') {
            res.status(401).json({error: true, data: {message: 'invalid token'}});
        }
        else {
            res.send({error: true, data: {message: 'invalid token'}});
        }
    }
});

app.post('/postWeeklyLog', function (req, res) {
    var decoded = jwt.verify(req.body.token, JWTKEY);
    if(decoded){
        knex('weeklysummarysheet')
            .where('LogId', req.body.LogId)
            .andWhere('UserId', req.session.user.UserId)
            .update({
                Binges: req.body.binges,
                VLD: req.body.vld,
                PhysicalActivity: req.body.physical,
                Weight: req.body.weight,
                FruitVegetableServings: req.body.fv,
                Events: req.body.events,
                GoodDays: req.body.goodDays,
                UpdatedDateTime: new Date()
            })
            .then(function (weeklySummary) {
                knex('activity')
                    .insert({
                        Id: uuid.v1(),
                        UserId: req.session.user.UserId,
                        Activity: 'Weekly Log',
                        ActivityDateTime: new Date()
                    })
                    .then( function (count) {
                        res.status(200).json({error: false, data: {weeklyLog: weeklySummary}});
                    })
                    .catch( function (err) {
                        res.status(500).json({error: true, data: {message: err.message}});
                    });
            })
            .catch(function (err) {
                res.status(500).json({error: true, data: {message: err.message}});
            });
    }else {
        res.status(401).json({error: true, data: {message: 'invalid token'}});
    }
});

app.post('/addNotes', function (req, res) {
    var decoded = jwt.verify(req.body.token, JWTKEY);
    if(decoded){
        knex('notes')
            .insert({
                Id: uuid.v1(),
                Notes: req.body.notes,
                UserId: req.session.user.UserId,
                IsVisible: req.body.isVisible
            })
            .then( function (notes) {
                res.status(200).json({error: false, data: {notes: notes}});
            })
            .catch( function (err) {
                res.status(500).json({error: true, data: {message: err.message}});
            });
    }
    else {
        res.status(401).json({error: true, data: {message: 'invalid token'}});
    }
});

app.post('/viewNotes', function (req, res) {
    var decoded = jwt.verify(req.body.token, JWTKEY);
    if(decoded){
        if(!req.session.user) {
            req.session.user = decoded.attributes;
        }
        var userId = '';
        var supporter = '';
        var isVisible = [];
        if (req.session.user.Role == 'Supporter' || req.session.user.Role == 'Admin') {
            userId = req.body.userId;
            supporter = req.session.user.UserId;
        }
        else {
            userId = req.session.user.UserId;
            supporter = req.session.user.SupporterId;
            isVisible.push(0);
        }
        isVisible.push(1);
        knex('notes').innerJoin('users', 'notes.UserId', 'users.UserId')
            .whereIn('IsVisible', isVisible)
            .andWhere('users.UserId', userId)
            .andWhere('SupporterId', supporter)
            .then( function (notes) {
                if (req.session.user.Role == 'Supporter' || req.session.user.Role == 'Admin') {
                    res.send({error: false, data: {notes: notes}});
                }
                else {
                    res.status(200).json({error: false, data: {notes: notes}});
                }
            })
            .catch( function (err) {
                if (req.session.user.Role == 'Supporter' || req.session.user.Role == 'Admin') {
                    res.send({error: true, data: {message: err.message}});
                }
                else {
                    res.status(200).json({error: true, data: {message: err.message}});
                }
            });
    } else {
        res.status(401).json({error: true, data: {message: 'invalid token'}});
    }
});

app.post('/getMotivationalMessage', function (req, res) {
     var decoded = jwt.verify(req.body.token, JWTKEY);
     if(decoded){
         var offset = Math.floor(Math.random() * (10 - 1)) + 1;
        knex.from('messages')
            .where('Label', req.body.label)
            .limit(1)
            .offset(offset)
            .then(function(message) {
                    res.json({error: false, data: {message: message}});
            })
            .catch(function (err){
                    res.status(500).json({error: true, data: {message: err.message}});
            })
     }
});

app.post('/setAppointment', function (req, res) {
    var decoded = jwt.verify(req.body.token, JWTKEY);
    if(decoded){
        if(!req.session.user) {
            req.session.user = decoded.attributes;
        }
        Appointments.forge({
            AppointmentId: uuid.v1(),
            UserId: req.body.userId,
            SupporterId: req.session.user.UserId,
            AppointmentTime: req.body.dateTime
            }).save(null, {method: 'insert'})
            .then(function (appointment) {
                res.send({error: false, data: {id: appointment.attributes.AppointmentId}});
            })
            .catch(function (err) {
                res.send({error: true, data: {message: err.message}});
            });
    }
    else {
        res.send({error: true, data: {message: 'invalid token'}});
    }
});

app.post('/getOccupiedTimes', function (req, res) {
    var decoded = jwt.verify(req.body.token, JWTKEY);
    if(decoded){
        if(!req.session.user) {
            req.session.user = decoded.attributes;
        }
        var startTime = req.body.date + ' 00:00:00';
        var endTime = req.body.date + ' 23:59:59';
        knex.from('appointments')
            .whereBetween('AppointmentTime', [startTime, endTime])
            .andWhere('SupporterId', req.session.user.UserId)
            .then(function (appointments) {
                res.send({error: false, data: {appointments: appointments}});
            })
            .catch(function (err) {
                res.send({error: true, data: {message: err.message}});
            });
    }
    else {
        res.send({error: true, data: {message: 'invalid token'}});
    }
});

app.post('/getMyAppointments', function (req, res) {
    var decoded = jwt.verify(req.body.token, JWTKEY);
    if(decoded){
        var id = '';
        if(!req.session.user) {
            req.session.user = decoded.attributes;
        }
        if (req.session.user.Role == 'Supporter' || req.session.user.Role == 'Admin') {
            id = req.body.userId;
        }
        else {
            id = req.session.user.UserId;
        }
        knex.from('appointments')
            .where('UserId', id)
            .then (function (appointments) {
                if (req.session.user.Role == 'Supporter' || req.session.user.Role == 'Admin') {
                    res.send({error: false, data: {appointments: appointments}});
                }
                else {
                    res.status(200).json({error: false, data: {appointments: appointments}});
                }
            })
            .catch( function (err) {
                res.status(500).json({error: true, data: {message: err.message}});
            })
    }
    else {
        res.status(401).json({error: true, data: {message: 'inavlid token'}});
    }
});

app.post('/setProgress', function (req, res) {
    var decoded = jwt.verify(req.body.token, JWTKEY);
    if(decoded){
        if(!req.session.user) {
            req.session.user = decoded.attributes;
        }
        knex('users')
            .where('UserId', req.body.userId)
            .andWhere('Role', 'Participant')
            .update({
                Level: req.body.level
            })
            .then(function (user) {
                res.send({error: false, user: user});
            })
            .catch(function (err) {
                res.send({error: true, data: {message: err.message}});
            });
    }
});

app.post('/getProgress', function (req, res) {
    var decoded = jwt.verify(req.body.token, JWTKEY);
    if(decoded){
        var Id = '';
        if(!req.session.user) {
            req.session.user = decoded.attributes;
        }
        if (req.session.user.Role == 'Supporter' || req.session.user.Role == 'Admin') {
            Id = req.body.userId;
        }
        else {
            Id = req.session.user.UserId;
        }
        knex('users')
            .where('UserID', Id)
            .then(function (users) {
                if (req.session.user.Role == 'Supporter' || req.session.user.Role == 'Admin') {
                    res.send({error: false, data: {progress: users[0].Level}});
                }
                else {
                    res.json({error: false, data: {progress: users[0].Level}});
                }
            })
            .catch(function (err) {
                if (req.session.user.Role == 'Supporter' || req.session.user.Role == 'Admin') {
                    res.send({error: false, data: {message: err.message}});
                }
                else {
                    res.status(500).json({error: true, data: {message: err.message}});
                }
            });
    }
});

app.post('/getChallenge', function (req, res) {
    var decoded = jwt.verify(req.body.token, JWTKEY);
    if(decoded) {
        if(!req.session.user) {
            req.session.user = decoded.attributes;
        }
        var challengeId = Math.floor(Math.random() * (21 - 1)) + 1;
        knex('challenges')
            .where('ChallengeId', challengeId)
            .then(function (challenge) {
                res.json({error: false, data: {challenge: challenge}});
            })
            .catch(function (err) {
                res.status(500).json({error: true, data: {message: err.message}});
            });
    }
});

cron.schedule('0 8 * * *', function(){
    var tomorrow = new Date() + 1;
    // knex('appointments').innerJoin('users', 'appointments.UserId', 'users.UserId')
    //     .whereBetween('AppointmentTime', [tomorrow , tomorrow + 1])
    //     .then( function (appointmentUsers) {
    //         //push for these users
    //         for (var user in appointmentUsers) {
    //             var alertMessage = 'You have an appointment coming up at ' + user.AppointmentTime;
                var pushMessage = new push.PushMessage(alertMessage);
                sendPushForDevice(user.DeviceId, pushMessage, function() {
                    res.json({error: false, data: {message: 'Push sent!'}});
                });
            //}
        //     console.log('push notification');
        // })
        // .catch( function (err) {
        //     //catch error
        // })
});

cron.schedule('*/15 * * * *', function () {
    var time = new Date(new Date().getTime() + 45*60000);
    var endTime = new Date(new Date().getTime() + 60*60000);
    knex('appointments').innerJoin('users', 'appointments.UserId', 'users.UserId')
        .whereBetween('AppointmentTime', [time, endTime])
        .then( function (appointmentUsers) {
            //push for these users
            console.log('push notification');
        })
        .catch( function(err) {
            //catch error
        });
});

var getSupporterId = function(supporterEmail){
    knex.from('users')
        .where('SupporterId', supporterEmail)
        .then( function (supporters) {
            return supporters[0].UserId;
        })
        .catch( function (err) {
            return err;
        })
};

app.get('/logout', function (req, res){
        if(!req.session.user) {
            req.session.user = decoded.attributes;
        }
        req.session.destroy();
        //remove deviceID
});

app.post('/createUser', function (req, res) {
    //var decoded = jwt.verify(req.body.token, JWTKEY);
    //if(decoded) {
    console.log(req.body.supporterEmail);
        var supporterId = '';
        if(req.body.role == 'Supporter') {
            supporterId = req.body.supporterEmail;
        }
        else {
            supporterId = getSupporterId(req.body.supporterEmail);
            console.log(supporterId);
        }
        var salt = genRandomString(16);
        knex('users')
            .insert({
                UserId: uuid.v1(),
                Username: req.body.username,
                HashedPassword: sha512(req.body.password, salt),
                Salt: salt,
                Role: req.body.role,
                Level: req.body.level,
                SupporterId: supporterId,
                Score: req.body.score,
                Messages: req.body.onMessages,
                ImageTagging: req.body.onImageTagging
            })
            .then( function (count) {
                res.status(200).json({error: false, data: {usersCreated: count}});
            })
            .catch( function (err) {
                res.status(500).json({error: true, data: {message: err.message}});
            });
    // }
    // else {
    //     res.status(401).json({error: true, data: {message: 'Invalid Credentials'}});
    // }
});

app.listen(8080,function(){
    console.log("Live at Port 8080");
});