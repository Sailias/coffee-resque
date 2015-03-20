// Generated by CoffeeScript 1.9.1
(function() {
  var Connection, EventEmitter, Worker, connectToRedis,
    slice = [].slice,
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  exports.version = '0.1.11';

  exports.connect = function(options) {
    return new exports.Connection(options || {});
  };

  EventEmitter = require('events').EventEmitter;

  Connection = (function() {
    function Connection(options) {
      this.redis = options.redis || connectToRedis(options);
      this.namespace = options.namespace || 'resque';
      this.callbacks = options.callbacks || {};
      this.timeout = options.timeout || 5000;
      if (options.database != null) {
        this.redis.select(options.database);
      }
    }

    Connection.prototype.enqueue = function(queue, func, args, callback) {
      var job, ref;
      if (typeof args === 'function') {
        ref = [args, []], callback = ref[0], args = ref[1];
      }
      this.redis.sadd(this.key('queues'), queue);
      job = JSON.stringify({
        "class": func,
        args: args || []
      });
      return this.redis.rpush([this.key('queue', queue), job], callback || function() {});
    };

    Connection.prototype.worker = function(queues, callbacks) {
      return new exports.Worker(this, queues, callbacks || this.callbacks);
    };

    Connection.prototype.end = function() {
      return this.redis.quit();
    };

    Connection.prototype.key = function() {
      var args;
      args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
      args.unshift(this.namespace);
      return args.join(":");
    };

    return Connection;

  })();

  Worker = (function(superClass) {
    extend(Worker, superClass);

    function Worker(connection, queues, callbacks) {
      this.conn = connection;
      this.redis = connection.redis;
      this.queues = queues;
      this.callbacks = callbacks || {};
      this.running = false;
      this.ready = false;
      this.checkQueues();
    }

    Worker.prototype.start = function() {
      if (this.ready) {
        return this.init((function(_this) {
          return function() {
            return _this.poll();
          };
        })(this));
      } else {
        return this.running = true;
      }
    };

    Worker.prototype.end = function(cb) {
      this.running = false;
      this.untrack();
      return this.redis.del([this.conn.key('worker', this.name), this.conn.key('worker', this.name, 'started'), this.conn.key('stat', 'failed', this.name), this.conn.key('stat', 'processed', this.name)], cb || function() {});
    };

    Worker.prototype.poll = function(title, nQueue) {
      if (nQueue == null) {
        nQueue = 0;
      }
      if (!this.running) {
        return;
      }
      if (title) {
        process.title = title;
      }
      this.queue = this.queues[nQueue];
      this.emit('poll', this, this.queue);
      return this.redis.lpop(this.conn.key('queue', this.queue), (function(_this) {
        return function(err, resp) {
          if (!err && resp) {
            return _this.perform(JSON.parse(resp.toString()));
          } else {
            if (err) {
              _this.emit('error', err, _this, _this.queue);
            }
            if (nQueue === _this.queues.length - 1) {
              return process.nextTick(function() {
                return _this.pause();
              });
            } else {
              return process.nextTick(function() {
                return _this.poll(title, nQueue + 1);
              });
            }
          }
        };
      })(this));
    };

    Worker.prototype.perform = function(job) {
      var cb, error, old_title;
      old_title = process.title;
      this.emit('job', this, this.queue, job);
      this.procline(this.queue + " job since " + ((new Date).toString()));
      if (cb = this.callbacks[job["class"]]) {
        this.workingOn(job);
        try {
          return cb.apply(null, slice.call(job.args).concat([(function(_this) {
            return function(result) {
              try {
                if (result instanceof Error) {
                  return _this.fail(result, job);
                } else {
                  return _this.succeed(result, job);
                }
              } finally {
                _this.doneWorking();
                process.nextTick((function() {
                  return _this.poll(old_title);
                }));
              }
            };
          })(this)]));
        } catch (_error) {
          error = _error;
          this.fail(new Error(error), job);
          this.doneWorking();
          return process.nextTick(((function(_this) {
            return function() {
              return _this.poll(old_title);
            };
          })(this)));
        }
      } else {
        this.fail(new Error("Missing Job: " + job["class"]), job);
        return process.nextTick(((function(_this) {
          return function() {
            return _this.poll(old_title);
          };
        })(this)));
      }
    };

    Worker.prototype.succeed = function(result, job) {
      this.redis.incr(this.conn.key('stat', 'processed'));
      this.redis.incr(this.conn.key('stat', 'processed', this.name));
      return this.emit('success', this, this.queue, job, result);
    };

    Worker.prototype.fail = function(err, job) {
      this.redis.incr(this.conn.key('stat', 'failed'));
      this.redis.incr(this.conn.key('stat', 'failed', this.name));
      this.redis.rpush(this.conn.key('failed'), JSON.stringify(this.failurePayload(err, job)));
      return this.emit('error', err, this, this.queue, job);
    };

    Worker.prototype.pause = function() {
      this.procline("Sleeping for " + (this.conn.timeout / 1000) + "s");
      return setTimeout((function(_this) {
        return function() {
          if (!_this.running) {
            return;
          }
          return _this.poll();
        };
      })(this), this.conn.timeout);
    };

    Worker.prototype.workingOn = function(job) {
      return this.redis.set(this.conn.key('worker', this.name), JSON.stringify({
        run_at: (new Date).toString(),
        queue: this.queue,
        payload: job
      }));
    };

    Worker.prototype.doneWorking = function() {
      return this.redis.del(this.conn.key('worker', this.name));
    };

    Worker.prototype.track = function() {
      this.running = true;
      return this.redis.sadd(this.conn.key('workers'), this.name);
    };

    Worker.prototype.untrack = function() {
      return this.redis.srem(this.conn.key('workers'), this.name);
    };

    Worker.prototype.init = function(cb) {
      var args, ref;
      this.track();
      args = [this.conn.key('worker', this.name, 'started'), (new Date).toString()];
      this.procline("Processing " + this.queues.toString + " since " + args.last);
      if (cb) {
        args.push(cb);
      }
      return (ref = this.redis).set.apply(ref, args);
    };

    Worker.prototype.checkQueues = function() {
      if (this.queues.shift != null) {
        return;
      }
      if (this.queues === '*') {
        return this.redis.smembers(this.conn.key('queues'), (function(_this) {
          return function(err, resp) {
            _this.queues = resp ? resp.sort() : [];
            _this.ready = true;
            _this.name = _this._name;
            if (_this.running) {
              return _this.start();
            }
          };
        })(this));
      } else {
        this.queues = this.queues.split(',');
        this.ready = true;
        return this.name = this._name;
      }
    };

    Worker.prototype.procline = function(msg) {
      return process.title = "resque-" + exports.version + ": " + msg;
    };

    Worker.prototype.failurePayload = function(err, job) {
      return {
        worker: this.name,
        queue: this.queue,
        payload: job,
        exception: err.name,
        error: err.message,
        backtrace: err.stack.split('\n').slice(1),
        failed_at: (new Date).toString()
      };
    };

    Object.defineProperty(Worker.prototype, 'name', {
      get: function() {
        return this._name;
      },
      set: function(name) {
        return this._name = this.ready ? [name || 'node', process.pid, this.queues].join(":") : name;
      }
    });

    return Worker;

  })(EventEmitter);

  connectToRedis = function(options) {
    var redis;
    redis = require('redis').createClient(options.port, options.host);
    if (options.password != null) {
      redis.auth(options.password);
    }
    return redis;
  };

  exports.Connection = Connection;

  exports.Worker = Worker;

}).call(this);