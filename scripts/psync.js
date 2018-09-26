'use strict';

const request = require('request');
const MongoClient    = require('mongodb').MongoClient;
const config = require('../components/config');

var rpc = {
    user: 'rpc000u1',
    password: 'rpc000u2',
    host: 'http://127.0.0.1:51314',
};

var proposals = [];

class CTaskHandler {
    constructor(name,init) {
        this.name = name;
        this.$tasks = [];
        this.result = null;
        if (init) {
          this.result = init(this);
        }
    }
    
    addTask(params,scope) {
      if (scope) {
        let interval = params.interval ? params.interval : 100;
        let tasknum = this.$tasks.length;
        this.$tasks.push({
           ready: false,
           si: setInterval(()=>{
              var result = scope(this,tasknum);
              if (result) {
                 if (result == 'ready') {
                   this.$tasks[tasknum].ready = true;
                   clearInterval(this.$tasks[tasknum].si);
                 } 
              } 
           },interval),
        });
        return tasknum;
      }
    }

    addTaskListenner(params) {
        if (params.$tasks) {
            if (params.$tasks.length > params.tasknum && 
                params.tasknum >= 0 && params.$tasks.length > 0) {
                let interval = params.interval ? params.interval : 100;
                let tasknum = this.$tasks.length;
                this.$tasks.push({
                    ready: false,
                    si: setInterval(()=>{
                        if (params.$tasks[params.tasknum].ready) {
                            if (params.onready) params.onready(this);
                            this.$tasks[tasknum].ready = true;
                            clearInterval(this.$tasks[tasknum].si);
                        }
                        if (params.oncycle) params.oncycle(this);
                    },interval),
                });
            }
        }
    }

    addTaskResult(tasknum, result) {
        if (this.$tasks) {
            if (this.$tasks.length > tasknum && 
                tasknum >= 0 && this.$tasks.length > 0) {
                    this.$tasks[tasknum].result = result;
                }
        }
    }

    getTaskResult(tasknum) {
        if (this.$tasks) {
            if (this.$tasks.length > tasknum && 
                tasknum >= 0 && this.$tasks.length > 0) {
                    return this.$tasks[tasknum].result;
                }
        }
    }
};

const TaskHandler = new CTaskHandler('taskhandler');

function newTask(func,interval) {
    return TaskHandler.addTask({
        interval: interval ? interval: 100,
    },func);
}

function listenTask(tasknum,onready,oncycle,interval) {
    TaskHandler.addTaskListenner({
        tasknum,
        $tasks: TaskHandler.$tasks,
        onready: onready ? onready: null,
        oncycle: oncycle ? oncycle: null,
        interval: interval ? interval: 100,
    });
}

function rpcOptions(method,params) {
    let options = {
        url: rpc.host,
        method: "post",
        headers:
        {
         "content-type": "text/plain"
        },
        auth: {
            user: rpc.user,
            pass: rpc.password
        },
        body: JSON.stringify( {"jsonrpc": "1.0", "id": "curltest", "method": method, "params": params })
    };

    return options;
}

function newRequest(options,callback) {
    try {
        //listen to request result
        var tasknum = newTask((self,tasknum)=>{
            var result = self.getTaskResult(tasknum);
            if (result) return 'ready';
        });
        
        //listen to task pulse
        listenTask(tasknum, (self) => {
            var result = self.getTaskResult(tasknum);
            callback(result);
        });

        //listen to request response
        request(options, (error,response, body) => {
            if (error) throw error;
            var result = JSON.parse(body);
            TaskHandler.addTaskResult(tasknum, result);
        });

    } catch(err) {
        console.log('Caught an error!');
    }
}

function storeProposal(database) {
    console.log('Storing proposals! (',proposals.length,')');
    var c = database.collection('proposals');
    //add items
    for (let i = 0; i < proposals.length; i++) {
        c.insertOne(proposals[i], (err, res)=> {
            if (err) throw err;
            console.log('OK!');
        });
    }
}

function saveProposals() {
    try {
        MongoClient.connect(config.host, { useNewUrlParser: true }, (err, client) => {
            if (err) throw err;

            var database = client.db(config.database);
            console.log('Database connected!');
            database.collection('proposals',(err,c)=> {
                c.find().count((err,n) => {
                    if (n > 0) { //clean collection
                        database.dropCollection('proposals', function(err, delOK) { 
                            if (err) throw err;
                            console.log('Collection cleaned!');
                            storeProposal(database);
                            client.close();
                        });
                    } else {
                        storeProposal(database);
                        client.close();
                    }
                });
            });
        });
    } catch(err) {
        console.log('MongoDB: Failed to connect!');
    }
}

function masternodeCount() {
    return 100;
}

function organizeProposal(value) {
    var ds_ = JSON.parse(value.DataString);
    var ds = ds_[0][1];
    var mc = masternodeCount();
    var p = {
        hash: value.Hash,
        name: ds.name,
        url: ds.url,
        address: ds.payment_address,
        paid: 0,
        totalPayment: 1,
        availablePayment: 1,
        requestPayment: ds.payment_amount,
        masternodesEnabled: mc,
        voteYes: value.YesCount,
        voteNo: value.NoCount,
        voteAbs: value.AbstainCount,
        funding: value.fCachedFunding,
        deleted: value.fCachedDelete,
        start: ds.start_epoch,
        end: ds.end_epoch,
    };
    return p;
}

function getProposals() {
    
    console.log('Getting proposals from RPC...');

    newRequest(rpcOptions('gobject',['list']), (result) => {
        console.log('Got result !');
        var list = result.result;
        for (var hash in list) {
            var p = organizeProposal(list[hash]);
            proposals.push(p);
        }
        saveProposals();
    });
}

//--init
getProposals();
