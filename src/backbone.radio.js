import _ from 'underscore';
import Backbone from 'backbone';

var previousRadio = Backbone.Radio;

var Radio = Backbone.Radio = {};

Radio.VERSION = '<%= version %>';

// This allows you to run multiple instances of Radio on the same
// webapp. After loading the new version, call `noConflict()` to
// get a reference to it. At the same time the old version will be
// returned to Backbone.Radio.
Radio.noConflict = function() {
  Backbone.Radio = previousRadio;
  return this;
};

// Whether or not we're in DEBUG mode or not. DEBUG mode helps you
// get around the issues of lack of warnings when events are mis-typed.
Radio.DEBUG = false;

// Format debug text.
function debugText(warning, eventName, channelName) {
  return warning + (channelName ? ' on the ' + channelName + ' channel' : '') +
    ': "' + eventName + '"';
};

// This is the method that's called when an unregistered event was called.
// By default, it logs warning to the console. By overriding this you could
// make it throw an Error, for instance. This would make firing a nonexistent event
// have the same consequence as firing a nonexistent method on an Object.
Radio.debugLog = function(warning, eventName, channelName) {
  if (Radio.DEBUG && console && console.warn) {
    console.warn(debugText(warning, eventName, channelName));
  }
};

var eventSplitter = /\s+/;

// An internal method used to handle Radio's method overloading for Requests.
// It's borrowed from Backbone.Events. It differs from Backbone's overload
// API (which is used in Backbone.Events) in that it doesn't support space-separated
// event names.
function eventsApi(obj, action, name, rest) {
  if (!name) {
    return false;
  }

  var results = {};

  // Handle event maps.
  if (typeof name === 'object') {
    for (var key in name) {
      var result = obj[action].apply(obj, [key, name[key]].concat(rest));
      eventSplitter.test(key) ? _.extend(results, result) : results[key] = result;
    }
    return results;
  }

  // Handle space separated event names.
  if (eventSplitter.test(name)) {
    var names = name.split(eventSplitter);
    for (var i = 0, l = names.length; i < l; i++) {
      results[names[i]] = obj[action].apply(obj, [names[i]].concat(rest));
    }
    return results;
  }

  return false;
};

// An optimized way to execute callbacks.
function callHandler(callback, context, args) {
  switch (args.length) {
    case 0: return callback.call(context);
    case 1: return callback.call(context, args[0]);
    case 2: return callback.call(context, args[0], args[1]);
    case 3: return callback.call(context, args[0], args[1], args[2]);
    default: return callback.apply(context, args);
  }
};

// A helper used by `off` methods to the handler from the store
function removeHandler(store, name, callback, context) {
  var event = store[name];
  if (
     (!callback || (callback === event.callback || callback === event.callback._callback)) &&
     (!context || (context === event.context))
  ) {
    delete store[name];
    return true;
  }
}

function removeHandlers(store, name, callback, context) {
  store || (store = {});
  var names = name ? [name] : _.keys(store);
  var matched = false;

  for (var i = 0, length = names.length; i < length; i++) {
    name = names[i];

    // If there's no event by this name, log it and continue
    // with the loop
    if (!store[name]) {
      continue;
    }

    if (removeHandler(store, name, callback, context)) {
      matched = true;
    }
  }

  return matched;
}

/*
 * tune-in
 * -------
 * Get console logs of a channel's activity
 *
 */

var _logs = {};

// This is to produce an identical function in both tuneIn and tuneOut,
// so that Backbone.Events unregisters it.
function _partial(channelName) {
  return _logs[channelName] || (_logs[channelName] = Radio.log.bind(Radio, channelName));
}

_.extend(Radio, {

  // Log information about the channel and event
  log: function(channelName, eventName) {
    if (typeof console === 'undefined') { return; }
    var args = _.toArray(arguments).slice(2);
    console.log('[' + channelName + '] "' + eventName + '"', args);
  },

  // Logs all events on this channel to the console. It sets an
  // internal value on the channel telling it we're listening,
  // then sets a listener on the Backbone.Events
  tuneIn: function(channelName) {
    var channel = Radio.channel(channelName);
    channel._tunedIn = true;
    channel.on('all', _partial(channelName));
    return this;
  },

  // Stop logging all of the activities on this channel to the console
  tuneOut: function(channelName) {
    var channel = Radio.channel(channelName);
    channel._tunedIn = false;
    channel.off('all', _partial(channelName));
    delete _logs[channelName];
    return this;
  }
});

/*
 * Backbone.Radio.Requests
 * -----------------------
 * A messaging system for requesting data.
 *
 */

function makeCallback(callback) {
  if (_.isFunction(callback)) {
    return callback;
  }
  var result = function() { return callback; };
  result._callback = callback;
  return result;
}

Radio.Requests = {

  // Make a request
  request: function(name) {
    var args = _.toArray(arguments).slice(1);
    var results = eventsApi(this, 'request', name, args);
    if (results) {
      return results;
    }
    var channelName = this.channelName;
    var requests = this._requests;

    // Check if we should log the request, and if so, do it
    if (channelName && this._tunedIn) {
      Radio.log.apply(this, [channelName, name].concat(args));
    }

    // If the request isn't handled, log it in DEBUG mode and exit
    if (requests && (requests[name] || requests['default'])) {
      var handler = requests[name] || requests['default'];
      args = requests[name] ? args : arguments;
      return callHandler(handler.callback, handler.context, args);
    } else {
      Radio.debugLog('An unhandled request was fired', name, channelName);
    }
  },

  // Set up a handler for a request
  reply: function(name, callback, context) {
    if (eventsApi(this, 'reply', name, [callback, context])) {
      return this;
    }

    this._requests || (this._requests = {});

    if (this._requests[name]) {
      Radio.debugLog('A request was overwritten', name, this.channelName);
    }

    this._requests[name] = {
      callback: makeCallback(callback),
      context: context || this
    };

    return this;
  },

  // Set up a handler that can only be requested once
  replyOnce: function(name, callback, context) {
    if (eventsApi(this, 'replyOnce', name, [callback, context])) {
      return this;
    }

    var self = this;

    var once = _.once(function() {
      self.stopReplying(name);
      return makeCallback(callback).apply(this, arguments);
    });

    return this.reply(name, once, context);
  },

  // Remove handler(s)
  stopReplying: function(name, callback, context) {
    if (eventsApi(this, 'stopReplying', name)) {
      return this;
    }

    // Remove everything if there are no arguments passed
    if (!name && !callback && !context) {
      delete this._requests;
    } else if (!removeHandlers(this._requests, name, callback, context)) {
      Radio.debugLog('Attempted to remove the unregistered request', name, this.channelName);
    }

    return this;
  }
};

/*
 * Backbone.Radio.channel
 * ----------------------
 * Get a reference to a channel by name.
 *
 */

Radio._channels = {};

Radio.channel = function(channelName) {
  if (!channelName) {
    throw new Error('You must provide a name for the channel.');
  }

  if (Radio._channels[channelName]) {
    return Radio._channels[channelName];
  } else {
    return (Radio._channels[channelName] = new Radio.Channel(channelName));
  }
};

/*
 * Backbone.Radio.Channel
 * ----------------------
 * A Channel is an object that extends from Backbone.Events,
 * and Radio.Requests.
 *
 */

Radio.Channel = function(channelName) {
  this.channelName = channelName;
};

_.extend(Radio.Channel.prototype, Backbone.Events, Radio.Requests, {

  // Remove all handlers from the messaging systems of this channel
  reset: function() {
    this.off();
    this.stopListening();
    this.stopReplying();
    return this;
  }
});

/*
 * Top-level API
 * -------------
 * Supplies the 'top-level API' for working with Channels directly
 * from Backbone.Radio.
 *
 */

var channel, args, systems = [Backbone.Events, Radio.Requests];

_.each(systems, function(system) {
  _.each(system, function(method, methodName) {
    Radio[methodName] = function(channelName) {
      args = _.toArray(arguments).slice(1);
      channel = this.channel(channelName);
      return channel[methodName].apply(channel, args);
    };
  });
});

Radio.reset = function(channelName) {
  var channels = !channelName ? this._channels : [this._channels[channelName]];
  _.each(channels, function(channel) { channel.reset();});
};

export default Radio;
