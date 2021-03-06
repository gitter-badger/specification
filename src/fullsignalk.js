/*
 * Copyright 2016, Teppo Kurki
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

var _ = require('lodash');
var signalkSchema = require('../')

//TODO
// timestamp prune?


function FullSignalK(id, type) {
  this.root = {
    vessels: {}
  };
  if (id) {
    this.root.vessels[id] = {};
    this.self = this.root.vessels[id];
    if (type) {
      this.root.vessels[id][type] = id;
    }
  }
  this.sources = {};
  this.root.sources = this.sources;
}

require("util").inherits(FullSignalK, require("events").EventEmitter);

FullSignalK.prototype.retrieve = function() {
  return this.root;
}

FullSignalK.prototype.addDelta = function(delta) {
  this.emit('delta', delta);
  var context = findContext(this.root, delta.context);
  this.addUpdates(context, delta.updates);
};

function findContext(root, contextPath) {
  var context = _.get(root, contextPath);
  if (!context) {
    context = {};
    _.set(root, contextPath, context);
  }
  signalkSchema.fillIdentityField(context, contextPath.split('.')[1]);
  return context;
}

FullSignalK.prototype.addUpdates = function(context, updates) {
  var len = updates.length;
  for (var i = 0; i < len; ++i) {
    this.addUpdate(context, updates[i]);
  }
}

FullSignalK.prototype.addUpdate = function(context, update) {
  if (update.source) {
    this.updateSource(context, update.source, update.timestamp);
  } else {
    console.error("No source in delta update:" + JSON.stringify(update));
  }
  addValues(context, update.source, update.timestamp, update.values);
}

FullSignalK.prototype.updateSource = function(context, source, timestamp) {
  if (!this.sources[source.label]) {
    this.sources[source.label] = {};
    this.sources[source.label].label = source.label;
    this.sources[source.label].type = source.type;
  }

  if (source.type === 'NMEA2000' || source.src) {
    handleNmea2000Source(this.sources[source.label], source, timestamp);
    return
  }

  if (source.type === 'NMEA0183' || source.sentence) {
    handleNmea0183Source(this.sources[source.label], source, timestamp);
    return
  }

  handleOtherSource(this.sources[source.label], source, timestamp);
}

function handleNmea2000Source(labelSource, source, timestamp) {
  if (!labelSource[source.src]) {
    labelSource[source.src] = {
      src: source.src,
      pgns: {}
    };
  }
  labelSource[source.src].pgns[source.pgn] = timestamp
}

function handleNmea0183Source(labelSource, source, timestamp) {
  var talker = source.talker || 'II';
  if (!labelSource[talker]) {
    labelSource[talker] = {
      talker: talker,
      sentences: {}
    };
  }
  labelSource[talker].sentences[source.sentence] = timestamp
}

function handleOtherSource(sourceLeaf, source, timestamp) {
  sourceLeaf.timestamp = timestamp;
}

function addValues(context, source, timestamp, pathValues) {
  var len = pathValues.length;
  for (var i = 0; i < len; ++i) {
    addValue(context, source, timestamp, pathValues[i]);
  }
}

function addValue(context, source, timestamp, pathValue) {
  var valueLeaf;
  if (pathValue.path.length === 0) {
    valueLeaf = context;
  } else {
    valueLeaf = pathValue.path.split('.').reduce(function(previous, pathPart) {
      if (!previous[pathPart]) {
        previous[pathPart] = {};
      }
      return previous[pathPart];
    }, context);
  }

  if (valueLeaf.values) { //multiple values already
    var sourceId = getId(source);
    if (!valueLeaf.values[sourceId]) {
      valueLeaf.values[sourceId] = {};
    }
    assignValueToLeaf(pathValue.value, valueLeaf.values[sourceId]);
    valueLeaf.values[sourceId].timestamp = timestamp;
    setMessage(valueLeaf.values[sourceId], source);
  } else if (valueLeaf.value && valueLeaf['$source'] != getId(source)) {
    // first multiple value

    var sourceId = valueLeaf['$source'];
    var tmp = {};
    copyLeafValueToLeaf(valueLeaf, tmp);
    valueLeaf.values = {};
    valueLeaf.values[sourceId] = tmp;
    valueLeaf.values[sourceId].timestamp = valueLeaf.timestamp;

    sourceId = getId(source);
    valueLeaf.values[sourceId] = {};
    assignValueToLeaf(pathValue.value, valueLeaf.values[sourceId]);
    valueLeaf.values[sourceId].timestamp = timestamp;
    setMessage(valueLeaf.values[sourceId], source);
  }
  assignValueToLeaf(pathValue.value, valueLeaf);
  if (pathValue.path.length != 0) {
    valueLeaf['$source'] = getId(source);
    valueLeaf.timestamp = timestamp;
  }
  setMessage(valueLeaf, source);
}

function copyLeafValueToLeaf(fromLeaf, toLeaf) {
  _.assign(toLeaf, _.omit(fromLeaf, ['$source', 'timestamp']));
}

function assignValueToLeaf(value, leaf) {
  if (_.isPlainObject(value)) {
    _.assign(leaf, value);
  } else {
    leaf.value = value;
  }
}

function setMessage(leaf, source) {
  if (!source) {
    return;
  }
  if (source.pgn) {
    leaf.pgn = source.pgn;
    delete leaf.sentence;
  }
  if (source.sentence) {
    leaf.sentence = source.sentence;
    delete leaf.pgn;
  }
}

function getId(source) {
  if (!source) {
    return 'no_source';
  }
  if (source.src || source.pgn) {
    return source.label +
      (source.src ? '.' + source.src : '');
  }
  return source.label +
    (source.talker ? '.' + source.talker : '.XX');
}
module.exports = FullSignalK;
