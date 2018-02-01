(function () {
  const htmlparser = require("htmlparser");
  const util = require('util');
  const isObject = util.isObject;
  const isArray = util.isArray;
  const isString = util.isString;
  const streams = require('memory-streams');

  const attributeRE = /([^=<>\"\'\s]+)\s*=\s*((?:"([^"]*)")|([-+]?[0-9]*\.?[0-9]+)|(?:{([^}]*)}))/g
 
  function ComponentParser(handler, options) {
    htmlparser.Parser.call(this, handler, { recognizeSelfClosing: true, ...options });
  }

  ComponentParser.prototype = Object.create(htmlparser.Parser.prototype);
  ComponentParser.prototype.constructor = ComponentParser;

  ComponentParser.prototype.parseAttribs = function ComponentParser$parseAttribs(elt) {
    if (elt.type!='text' && elt.data) {
      const rawAttrs = elt.data.split(/\s+(.*)/)[1];
      var match;
      var attribs = {};
      while ((match=attributeRE.exec(rawAttrs))!=null) {
        var variable = match[1]
        if (match[3]) { // string
          attribs[variable] = match[3];
        } else if (match[4]) { // number
          attribs[variable] = parseFloat(match[4]);
        } else if (match[5]) { // interpolation 
          attribs[variable] = { accessor: match[5].trim(' ') };
        }
      }
      elt.attribs = attribs;
    }
  }

  function parse(input) {
    var handler = new htmlparser.DefaultHandler(function (error, dom) {
      if (error) {
        throw error;
      }
    });

    var parser = new ComponentParser(handler);
    parser.parseComplete(input);

    return handler.dom;
  };
  
  function standardDefaultComponent(props, render) {
    var tagName = props.__name;
    var children = props.__children;
    var attrs = Object.assign({}, props);
    delete attrs.__name;
    delete attrs.__children;

    render(`<${tagName}`);
    for (var attr in attrs) {
      render(' %s=%j', attr, attrs[attr]);
    }
    render('>');
    render(children);
    render(`</${tagName}>`);
  }

  function standardInterpolator(variables, accessor) {
    if (isArray(accessor)) {
      if (accessor.length==0) {
        return variables;
      } else {
        if (variables) {
          return standardInterpolator(variables[accessor[0]], accessor.slice(1));
        }
      }
    } else {
      return standardInterpolator(variables, accessor.split('.'));
    }
  }

  function interpolateAttributes(attribs, context, interpolator) {
    var props = {};
    if (attribs) {
      for (var key in attribs) {
        var value = attribs[key];
        if (isObject(value)) {
          props[key] = interpolator(context, value.accessor);
        } else {
          props[key] = value;
        }
      }
    }
    return props;
  }

  /**
   * Renderer
   * 
   * @param {any} options
   * @param {Object} components - { componentName: function (renderer, tagName, attrs, children, stream) => writes HTML to stream, ... }
   * @param {Function} markdownEngine - function (markdown, stream) => writes HTML to stream
   * @param {Function} defaultComponent - function (renderer, tagName, attrs, children, stream)
   * @param {Function} interpolator - optional interpolation function (variables, expr) => value (default is standardInterpolator)
   * 
   * components are functions of the form (renderer, tagName, attrs, children, stream) => {}
   * interpolator uses the expression inside {} to extract a value from variables
   */
  function Renderer({ components, markdownEngine, defaultComponent, interpolator }) {
    this._components = {};
    for (var key in components || {}) {
      this._components[key.toLowerCase()] = components[key];
    }
    this._defaultComponent = defaultComponent || standardDefaultComponent;
    this._interpolator = interpolator || standardInterpolator;
    this._markdownEngine = markdownEngine;
  }

  Renderer.prototype.componentFromElement = function (element) {
    if (element.type=='text') {
      return this._markdownRenderer;
    } else {
      return this._components[element.name.toLowerCase()] || this._defaultComponent;
    }
  }

  Renderer.prototype.writeElement = function(elt, context, stream) {
    const _this = this;
    const render = function (obj) {
      if (isString(obj)) {
        stream.write(obj);
      } else {
        _this.write(obj, context, stream);
      }
    };
    
    // render markdown
    if (elt.type=='text') {
      this._markdownEngine(elt.data, render); // TODO: remove this branch, turn it into a component
    } else {
      // or a component:
      const component = this.componentFromElement(elt) || this._defaultComponent;
      if (component) {  
        // inject __name and __children into props
        const props = Object.assign(
          { __name: elt.name, __children: elt.children },
          interpolateAttributes(elt.attribs, context, _this._interpolator)
        );
        component(props, render);
      } 
    } 
  }

  Renderer.prototype.write = function(elt, context, stream) {
    if (!elt) {
      return;
    } else if (isArray(elt)) {
      var _this = this;
      var elements = elt;
      elements.forEach(function (elt) {
        _this.write(elt, context, stream);
      });
    } else if (isObject(elt)) {
      this.writeElement(elt, context, stream);
    } else {
      throw new Error(`Unexpected dom element: ${JSON.stringify(elt)}`);
    }
  }

  /**
   * toHTML - Combines parsing and rendering in one easy step
   * 
   * @param {any} options
   * @param {string} options.input  - markdown with components
   * @param {Object} options.components - { componentName: function ({__name, __children, ...props}, render) => use render method to write to stream
   * @param {Function} options.markdownEngine - function (text, render) => writes HTML using render method
   * @param {Function} options.defaultComponent - function ({__name, __children, ...props}, render)
   * @param {Function} options.interpolator - optional interpolation function (variables, expr) => value (default is standardInterpolator)
   
   * @returns {string} HTML
   */
  function toHTML({ input, components, markdownEngine, context }) {
    var renderer = new Renderer({ 
      components: components, 
      markdownEngine: markdownEngine
    });
    var stream = new streams.WritableStream();
    renderer.write(parse(input), context, stream);
    return stream.toString();
  }

  module.exports = { parse: parse, Renderer: Renderer, toHTML: toHTML };
})();