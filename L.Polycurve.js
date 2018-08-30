/** @typedef instruction
* @property {string} instr - M L H V C S Q T A Zz
* @property {L.LatLng} [latlng] - The only instructions that don't use this are 'H V Z'
* @property {Array.<L.LatLng>} [controls] - Control points for C S Q, array length 2 for C, 1 for S and Q
* @property {number} [lat] - V
* @property {number} [lng] - H
* @property {L.Point} [radius] - A (Probably going to use point in meters like L.Circle)
* @property {number} [angle] - A
* @property {boolean} [largeArc] - A
* @property {boolean} [sweep] - A
*/

L.Polycurve = L.Polyline.extend({
  initialize: function(instructions, options){
    instructions = instructions ||
    //example
    [{ instr: "M",
      latlng: L.latLng(0,0)
    },
    {
      instr: "C",
      latlng: L.latLng(0,1),
      controls: [L.latLng(1,2), L.latLng(4,5)]
    },
    {
      instr: "A",
      latlng: L.latLng(4.5, 5.01),
      radius: L.point(1e6, 2e6),
      largeArc: true,
      sweep: true,
      angle: 30
    },{
      instr: 'Z'
    }];
    var prevLatLng;
    var latlngs = instructions.map(function(instr){
      result = instr === 'V'?
        L.latLng(instr.lat, prevLatLng.lng):
      instr === 'H'?
        L.latLng(prevLatLng.lat, instr.lng):
      instr.latlng;
      prevLatLng = instr.latlng;
      return result;
    }).filter(function(v){return v;}); // Remove 'Z' instructions

    // Will set the options as well as all 'destinations' in _latlngs
    L.Polyline.prototype.initialize.call(this, latlngs, options);

    // But we aren't using _latlngs once this is finished
    this.setInstructions(instructions);
  },
  setInstructions: function(instructions){
    this._instructions = instructions.map(function(instr){
      if (!instr.controls){
        if ("CSQ".indexOf(instr.instr) !== -1){
          instr.controls = [instr.latlng];
        }
      }
      else if ("C" === instr.instr && instr.controls.length === 1){
        instr.controls.push(instr.controls[0]);
      }
      return instr;
    }, this);
  },
  /** Creates the svg path attribute that defines the entire string (including polygon holes, etc)
	* @returns {string} svg path instructions @see {@link https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/d}
	*/
	getPathString: function () {
		// this._parts is [ this._originalPoints ] possibly modified by _clipPoints
    /** @type {Array.<Array.<L.Point>>}*/
		return this._pointInstructions.map(function(instr){
			return this._getPathPartStr(instr);
		}, this).join(' ');
	},
  _getPathPartStr: function(instr){
    return instr.instr +
      (instr.instr==="A"?
        [instr.radius.x, instr.radius.y, instr.angle, instr.largeArc?1:0, instr.sweepinstr.largeArc?1:0]:
      instr.controls&&instr.controls||[]).join(' ')+
      (instr.point||instr.x||instr.y||"");
  },
  projectLatlngs: function () {
    var latlngToPoint = function(latlngs){
      if (Array.isArray(latlngs)){
        return latlngs.map(latlngToPoint, this);
      }
      else {
        return this._map.latLngToLayerPoint(latlngs);
      }
    };

    if (this._map){
			//Checks if latlng is not 'undefined' TODO patch upstream
			/** @type {Array.<L.LayerPoint>} */
			this._originalPoints = this._latlngs.filter(function(latlng){
				return latlng;
			}).map(latlngToPoint, this);

      this._pointInstructions = this._instructions.filter(function(instr){
        var ptInstr = L.Util.extend({}, instr);

        if (ptInstr.latlng){
          ptInstr.point = latlngToPoint(instr.latlng);
          delete ptInstr.latlng;
        }

        if (ptInstr.controls) {
          ptInstr.controls = ptInstr.controls.map(latlngToPoint, this);
        }

        if (ptInstr.lat){
          // Assumes point orientation aligned with latlng orientation (not rotated)
          ptInstr.y = latlngToPoint([ptInstr.lat, 0]).y;
          delete ptInstr.lat;
        }
        if (ptInstr.lng){
          // Assumes point orientation aligned with latlng orientation (not rotated)
          ptInstr.x = latlngToPoint([0, ptInstr.lng]).x;
          delete ptInstr.lng;
        }
        return ptInstr;
      });
    }
	},
  /**
	* @private
	*/
	_clipPoints: function () {
		var points = this._originalPoints || [],
		    len = points.length,
		    i, k, segment;

		if (this.options.noClip) {
			this._parts = [points];
			return;
		}

		this._parts = [];

		var parts = this._parts,
		    vp = this._map._pathViewport,
		    lu = L.LineUtil;

		for (i = 0, k = 0; i < len - 1; i++) {
			segment = lu.clipSegment(points[i], points[i + 1], vp, i);
			if (!segment) {
				continue;
			}

			parts[k] = parts[k] || [];
			parts[k].push(segment[0]);

			// if segment goes out of screen, or it's the last one, it's the end of the line part
			if ((segment[1] !== points[i + 1]) || (i === len - 2)) {
				parts[k].push(segment[1]);
				k++;
			}
		}
	},


  /** Simplify each clipped part of the polyline.
    This is taken from L.Polyline,
    TODO replace L.LineUtil.simplify with class counterpart for
  * @param {Array.<Array.<L.Point>>} [parts = this._parts]
	* @protected
	*/
	_simplifyPoints: function (parts) {
		(parts||this._parts).forEach(function(part){
			if (part instanceof L.Point){
				part = L.LineUtil.simplify(part, this.options.smoothFactor);
			}
		}, this);
	},


  closestLayerPoint: function (p) {
		var minDistance = Infinity, parts = this._parts, p1, p2, minPoint = null;

		for (var j = 0, jLen = parts.length; j < jLen; j++) {
			var points = parts[j];
			for (var i = 1, len = points.length; i < len; i++) {
				p1 = points[i - 1];
				p2 = points[i];
				var sqDist = L.LineUtil._sqClosestPointOnSegment(p, p1, p2, true);
				if (sqDist < minDistance) {
					minDistance = sqDist;
					minPoint = L.LineUtil._sqClosestPointOnSegment(p, p1, p2);
				}
			}
		}
		if (minPoint) {
			minPoint.distance = Math.sqrt(minDistance);
		}
		return minPoint;
	},

});
