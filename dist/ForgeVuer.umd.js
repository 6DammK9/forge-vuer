(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (factory((global.ForgeVuer = {})));
}(this, (function (exports) { 'use strict';

  /**
   *
   * @param {Object} autodeskViewing Autodesk's Viewing
   * @param {Function} baseExtension Autodesk.Viewing.Extension
   * @param {Object} customExtensions Custom extensions
   */
  var AddCustomExtensions = function (autodeskViewing, baseExtension, customExtensions) {
    var extensionNames = Object.keys(customExtensions);
    var registeredEvents = [];

    for (var i = 0; i < extensionNames.length; i++) {
      var name = extensionNames[i];
      var ExtensionCtor = customExtensions[name];
      var extended = new ExtensionCtor(baseExtension, autodeskViewing);
      var result = autodeskViewing.theExtensionManager.registerExtension(name, extended);

      if (result === true) {
        registeredEvents.push(name);
      }
    }

    return registeredEvents;
  };

  var VueToViewer3DEvent = function (eventName) {
    // Vuer component events should be on the same as Viewer3D's,
    // but low case and hypen insted of underscore
    return eventName.toUpperCase().replace(/-/g, '_');
  };

  var CreateEmitterFunction = function (vue, name) {
    return function () {
      var prop = [], len = arguments.length;
      while ( len-- ) prop[ len ] = arguments[ len ];

      var p = Object.assign.apply(Object, [ {} ].concat( prop ));
      delete p.target;
      delete p.type;
      vue.$emit(name, p);
    };
  };

  var EmitError = function (vue, error) {
    vue.$emit('onError', error);
  };
  /**
   * Creates a new ViewerService object to handle viewer interaction
   * @param {Object} ViewerSDK Forge Viewer Autodesk SDK
   */


  var ViewerService = function ViewerService(Autodesk, VueInstance) {
    this.AutodeskViewing = null;
    this.Viewer3D = null;
    this.Events = {};
    this.VueInstance = null;

    this.SetCustomExtensions = function (extensions) {
      this.CustomExtensions = extensions;
    };

    this.HasCustomExtensions = function () {
      return this.CustomExtensions && Object.keys(this.CustomExtensions).length > 0;
    };

    this.GetViewer3DConfig = function () {
      var config3d = {};

      if (this.HasCustomExtensions()) {
        var registered = AddCustomExtensions(this.AutodeskViewing, this.Extension, this.CustomExtensions);
        config3d['extensions'] = registered;
      }

      return config3d;
    };

    this.SetEvents = function (events) {
      this.Events = events.filter(function (name) { return name.endsWith('-event'); }).reduce(function (acc, name) {
        acc[name] = null;
        return acc;
      }, {});
    };

    this.LaunchViewer = async function (containerId, getTokenMethodAsync) {
      var this$1 = this;

      var options = {
        env: 'AutodeskProduction',
        getAccessToken: getTokenMethodAsync
      };
      return new Promise(function (resolve, reject) {
        try {
          this$1.ViewerContainer = document.getElementById(containerId);
          this$1.AutodeskViewing.Initializer(options, function () {
            resolve(true);
          });
        } catch (error) {
          EmitError(this$1.VueInstance, error);
          reject(error);
        }
      });
    };

    this.LoadDocument = function (urn) {
      var documentId = "urn:" + urn;

      try {
        this.AutodeskViewing.Document.load(documentId, this.onDocumentLoadSuccess.bind(this), this.onDocumentLoadError.bind(this));
      } catch (error) {
        EmitError(this.VueInstance, error);
      }
    };

    this.RegisterEvents = function () {
      var eventNames = Object.keys(this.Events);

      if (eventNames.length > 0) {
        for (var i = 0; i < eventNames.length; i++) {
          var vueEventname = eventNames[i];
          var viewerEventName = VueToViewer3DEvent(vueEventname);
          var eventType = this.AutodeskViewing[viewerEventName];

          if (eventType != null) {
            var emitterFunction = CreateEmitterFunction(this.VueInstance, vueEventname);
            this.Events[vueEventname] = emitterFunction;
            this.Viewer3D.addEventListener(eventType, emitterFunction);
          } else {
            console.log(("Event '" + vueEventname + "' doesn't exist on Forge Viewer"));
          }
        }
      }
    };

    this.onDocumentLoadSuccess = function (doc) {
      var geometries = doc.getRoot().search({
        'type': 'geometry'
      });

      if (geometries.length === 0) {
        EmitError(this.VueInstance, new Error('Document contains no geometries.'));
        return;
      } // Load the chosen geometry


      var svfUrl = doc.getViewablePath(geometries[0]);
      var modelOptions = {
        sharedPropertyDbPath: doc.getPropertyDbPath()
      }; // If Viewer3D is null, it needs to be created and started.

      if (this.Viewer3D == null) {
        this.Viewer3D = new this.AutodeskViewing.Private.GuiViewer3D(this.ViewerContainer, this.GetViewer3DConfig());
        this.Viewer3D.start(svfUrl, modelOptions, this.onModelLoaded.bind(this), this.onModelLoadError.bind(this));
        this.RegisterEvents(); // Emitting Viewer3D Started event

        this.VueInstance.$emit('onViewerStarted', this.Viewer3D);
      } else {
        this.Viewer3D.tearDown();
        this.Viewer3D.load(svfUrl, modelOptions, this.onModelLoaded.bind(this), this.onModelLoadError.bind(this));
      }
    };

    this.onDocumentLoadError = function (errorCode) {
      this.VueInstance.$emit('onDocumentLoadError', errorCode);
    };

    this.onModelLoaded = function (item) {
      this.VueInstance.$emit('onModelLoaded', item);
    };

    this.onModelLoadError = function (errorCode) {
      this.VueInstance.$emit('onModelLoadError', errorCode);
    };

    /**
     * Autodesk.Viewing object
     */
    this.AutodeskViewing = Autodesk.Viewing;
    /**
     * Autodesk.Vieweing.Extensions function
     */

    this.Extension = Autodesk.Viewing.Extension;
    this.VueInstance = VueInstance;
    /**
     * Custom Extensions loaded by client
     */

    this.CustomExtensions = {};
    this.ViewerContainer;
  };

  //
  var script = {
    name: 'ForgeVuer',
    props: {
      containerId: {
        type: String,
        default: function () {
          return 'fv-container';
        }
      },
      setAccessToken: {
        type: Function,
        required: true
      },
      urn: {
        type: String,
        required: true
      },
      extensions: {
        type: Object
      }
    },
    watch: {
      urn: function () {
        this.viewerService.LoadDocument(this.urn);
      }
    },

    data: function data() {
      return {
        viewerService: null,
        token: null,
        timeout: 3600000,
        expires: null,
        events: []
      };
    },

    mounted: async function () {
      // Retrieving Autodesk global object.
      if (!window.Autodesk) {
        throw new Error("Forge Viewer js missing. Make sure you add it on the HTML header");
      } else if (typeof this.setAccessToken !== 'function') {
        throw new Error("The 'setToken' prop needs to be a function \n                implementing a callback passing in the generated token and expire timeout in seconds.");
      } else {
        this.viewerService = new ViewerService(window.Autodesk, this); // If any event, try to add it to the Viewer instance

        this.events = Object.keys(this.$listeners);
        this.viewerService.SetEvents(this.events);

        if (this.extensions && Object.keys(this.extensions).length > 0) {
          this.viewerService.SetCustomExtensions(this.extensions);
        } // Creating a new instance of the ViewerService


        await this.viewerService.LaunchViewer(this.containerId, this.setAccessToken); // If a urn is supplied, load it to viewer;

        if (this.urn != null && typeof this.urn === 'string') {
          this.viewerService.LoadDocument(this.urn);
        }
      }
    },
    methods: {
      /**
       * Setting the component to refresh the user input token logic
       * after the timeout 
       */
      _setRefreshInterval: function () {
        var this$1 = this;

        setInterval(function () {
          this$1.setToken(this$1._setToken);
        }, this.timeout);
      },

      /**
       * Callback function to be call from setToken prop
       */
      _setToken: function (token, timeout) {
        if ( timeout === void 0 ) timeout = 3600;

        this.token = token;
        this.timeout = timeout;
        this.expires = Date.now() + timeout;
      }
    }
  };

  function normalizeComponent(template, style, script, scopeId, isFunctionalTemplate, moduleIdentifier
  /* server only */
  , shadowMode, createInjector, createInjectorSSR, createInjectorShadow) {
    if (typeof shadowMode !== 'boolean') {
      createInjectorSSR = createInjector;
      createInjector = shadowMode;
      shadowMode = false;
    } // Vue.extend constructor export interop.


    var options = typeof script === 'function' ? script.options : script; // render functions

    if (template && template.render) {
      options.render = template.render;
      options.staticRenderFns = template.staticRenderFns;
      options._compiled = true; // functional template

      if (isFunctionalTemplate) {
        options.functional = true;
      }
    } // scopedId


    if (scopeId) {
      options._scopeId = scopeId;
    }

    var hook;

    if (moduleIdentifier) {
      // server build
      hook = function hook(context) {
        // 2.3 injection
        context = context || // cached call
        this.$vnode && this.$vnode.ssrContext || // stateful
        this.parent && this.parent.$vnode && this.parent.$vnode.ssrContext; // functional
        // 2.2 with runInNewContext: true

        if (!context && typeof __VUE_SSR_CONTEXT__ !== 'undefined') {
          context = __VUE_SSR_CONTEXT__;
        } // inject component styles


        if (style) {
          style.call(this, createInjectorSSR(context));
        } // register component module identifier for async chunk inference


        if (context && context._registeredComponents) {
          context._registeredComponents.add(moduleIdentifier);
        }
      }; // used by ssr in case component is cached and beforeCreate
      // never gets called


      options._ssrRegister = hook;
    } else if (style) {
      hook = shadowMode ? function () {
        style.call(this, createInjectorShadow(this.$root.$options.shadowRoot));
      } : function (context) {
        style.call(this, createInjector(context));
      };
    }

    if (hook) {
      if (options.functional) {
        // register for functional component in vue file
        var originalRender = options.render;

        options.render = function renderWithStyleInjection(h, context) {
          hook.call(context);
          return originalRender(h, context);
        };
      } else {
        // inject component registration as beforeCreate hook
        var existing = options.beforeCreate;
        options.beforeCreate = existing ? [].concat(existing, hook) : [hook];
      }
    }

    return script;
  }

  var normalizeComponent_1 = normalizeComponent;

  var isOldIE = typeof navigator !== 'undefined' && /msie [6-9]\\b/.test(navigator.userAgent.toLowerCase());

  function createInjector(context) {
    return function (id, style) {
      return addStyle(id, style);
    };
  }

  var HEAD = document.head || document.getElementsByTagName('head')[0];
  var styles = {};

  function addStyle(id, css) {
    var group = isOldIE ? css.media || 'default' : id;
    var style = styles[group] || (styles[group] = {
      ids: new Set(),
      styles: []
    });

    if (!style.ids.has(id)) {
      style.ids.add(id);
      var code = css.source;

      if (css.map) {
        // https://developer.chrome.com/devtools/docs/javascript-debugging
        // this makes source maps inside style tags work properly in Chrome
        code += '\n/*# sourceURL=' + css.map.sources[0] + ' */'; // http://stackoverflow.com/a/26603875

        code += '\n/*# sourceMappingURL=data:application/json;base64,' + btoa(unescape(encodeURIComponent(JSON.stringify(css.map)))) + ' */';
      }

      if (!style.element) {
        style.element = document.createElement('style');
        style.element.type = 'text/css';
        if (css.media) { style.element.setAttribute('media', css.media); }
        HEAD.appendChild(style.element);
      }

      if ('styleSheet' in style.element) {
        style.styles.push(code);
        style.element.styleSheet.cssText = style.styles.filter(Boolean).join('\n');
      } else {
        var index = style.ids.size - 1;
        var textNode = document.createTextNode(code);
        var nodes = style.element.childNodes;
        if (nodes[index]) { style.element.removeChild(nodes[index]); }
        if (nodes.length) { style.element.insertBefore(textNode, nodes[index]); }else { style.element.appendChild(textNode); }
      }
    }
  }

  var browser = createInjector;

  /* script */
  var __vue_script__ = script;

  /* template */
  var __vue_render__ = function() {
    var _vm = this;
    var _h = _vm.$createElement;
    var _c = _vm._self._c || _h;
    return _c(
      "div",
      { staticClass: "forge-vuer-container" },
      [
        _c("div", {
          staticClass: "forge-vuer-viewer-display",
          attrs: { id: _vm.containerId }
        }),
        _vm._v(" "),
        _vm._t("default")
      ],
      2
    )
  };
  var __vue_staticRenderFns__ = [];
  __vue_render__._withStripped = true;

    /* style */
    var __vue_inject_styles__ = function (inject) {
      if (!inject) { return }
      inject("data-v-0813d5fc_0", { source: "\n.forge-vuer-container{\r\n    width: 100%;\r\n    height: 100%;\r\n    position: relative;\n}\n.forge-vuer-viewer-display{\r\n    height: 100%;\n}\r\n", map: {"version":3,"sources":["C:\\Users\\AlvaroOrtegaPickmans\\Documents\\GitHub\\Forge\\forge-vuer\\src\\ForgeVuer.vue"],"names":[],"mappings":";AA0GA;IACA,WAAA;IACA,YAAA;IACA,kBAAA;AACA;AAEA;IACA,YAAA;AACA","file":"ForgeVuer.vue","sourcesContent":["<template>\r\n    <div class=\"forge-vuer-container\" >\r\n        <div class=\"forge-vuer-viewer-display\" :id=\"containerId\"/>\r\n        <slot />\r\n    </div>\r\n</template>\r\n\r\n<script>\r\nimport { ViewerService } from './services/ViewerServices.js';\r\n\r\nexport default {\r\n    name: 'ForgeVuer',\r\n    props:{\r\n\r\n        containerId:{\r\n            type: String,\r\n            default: function(){\r\n                return 'fv-container'\r\n            }\r\n        },\r\n\r\n        setAccessToken: {\r\n            type: Function,\r\n            required: true\r\n        },\r\n        urn:{\r\n            type: String,\r\n            required: true\r\n        },\r\n\r\n        extensions:{\r\n            type: Object\r\n        }\r\n    },\r\n\r\n    watch: {\r\n        urn: function(){\r\n            this.viewerService.LoadDocument(this.urn);\r\n        }\r\n    },\r\n    \r\n    data() {\r\n        return {\r\n            viewerService: null,\r\n            token: null,\r\n            timeout: 3600000,\r\n            expires: null,\r\n            events: [],\r\n        }\r\n    },\r\n    mounted: async function(){\r\n\r\n        // Retrieving Autodesk global object.\r\n        if(!window.Autodesk){\r\n            throw new Error(\"Forge Viewer js missing. Make sure you add it on the HTML header\");\r\n        }\r\n        else if(typeof this.setAccessToken !== 'function'){\r\n            throw new Error(`The 'setToken' prop needs to be a function \r\n                implementing a callback passing in the generated token and expire timeout in seconds.`)\r\n        }\r\n        else{\r\n            this.viewerService = new ViewerService(window.Autodesk, this);\r\n            // If any event, try to add it to the Viewer instance\r\n            this.events = Object.keys(this.$listeners);\r\n            this.viewerService.SetEvents(this.events);\r\n\r\n            if(this.extensions && Object.keys(this.extensions).length > 0){\r\n                this.viewerService.SetCustomExtensions(this.extensions);\r\n            }\r\n            // Creating a new instance of the ViewerService\r\n            await this.viewerService.LaunchViewer(this.containerId, this.setAccessToken);\r\n\r\n            // If a urn is supplied, load it to viewer;\r\n            if(this.urn != null && typeof this.urn === 'string'){\r\n                this.viewerService.LoadDocument(this.urn);\r\n            }\r\n        }\r\n               \r\n\r\n\r\n\r\n    },\r\n    methods: {\r\n        /**\r\n         * Setting the component to refresh the user input token logic\r\n         * after the timeout \r\n         */\r\n        _setRefreshInterval: function(){\r\n           setInterval(() => {\r\n               this.setToken(this._setToken);\r\n           }, this.timeout);\r\n        },\r\n\r\n        /**\r\n         * Callback function to be call from setToken prop\r\n         */\r\n        _setToken: function(token, timeout = 3600 ){\r\n            this.token = token;\r\n            this.timeout = timeout;\r\n            this.expires = Date.now() + timeout;\r\n        }\r\n    }\r\n}\r\n</script>\r\n\r\n<style>\r\n.forge-vuer-container{\r\n    width: 100%;\r\n    height: 100%;\r\n    position: relative;\r\n}\r\n\r\n.forge-vuer-viewer-display{\r\n    height: 100%;\r\n}\r\n</style>\r\n"]}, media: undefined });

    };
    /* scoped */
    var __vue_scope_id__ = undefined;
    /* module identifier */
    var __vue_module_identifier__ = undefined;
    /* functional template */
    var __vue_is_functional_template__ = false;
    /* style inject SSR */
    

    
    var component = normalizeComponent_1(
      { render: __vue_render__, staticRenderFns: __vue_staticRenderFns__ },
      __vue_inject_styles__,
      __vue_script__,
      __vue_scope_id__,
      __vue_is_functional_template__,
      __vue_module_identifier__,
      browser,
      undefined
    )

  function install(Vue) {
    if (install.installed) { return; }
    install.installed = true;
    Vue.component('ForgeVuer', component);
  } // Create module definition for Vue.use()

  var plugin = {
    install: install
  }; // Auto-install when vue is found (eg. in browser via <script> tag)

  var GlobalVue = null;

  if (typeof window !== 'undefined') {
    GlobalVue = window.Vue;
  } else if (typeof global !== 'undefined') {
    GlobalVue = global.Vue;
  }

  if (GlobalVue) {
    GlobalVue.use(plugin);
  } // To allow use as module (npm/webpack/etc.) export component

  exports.install = install;
  exports.default = component;

  Object.defineProperty(exports, '__esModule', { value: true });

})));
