/**
 *
 * @param {Object} autodeskViewing Autodesk's Viewing
 * @param {Function} baseExtension Autodesk.Viewing.Extension
 * @param {Object} customExtensions Custom extensions
 */
const AddCustomExtensions = function(autodeskViewing, baseExtension, customExtensions){

  let extensionNames = Object.keys(customExtensions);

  let registeredEvents = [];

  for(let i = 0; i < extensionNames.length; i++){
    let name = extensionNames[i];
    let ExtensionCtor = customExtensions[name];

    let extended = new ExtensionCtor(baseExtension, autodeskViewing);

    let result = autodeskViewing.theExtensionManager.registerExtension(name, extended);
    if(result === true){
      registeredEvents.push(name);
    }
  }

  return registeredEvents;

}

const VueToViewer3DEvent = function(eventName){
  // Vuer component events should be the same as Viewer3D's,
  // but low cased and hypen insted of underscore

  return eventName.toUpperCase().replace(/-/g, '_');
}

const CreateEmitterFunction = function(vue, name){
  return (...prop) => {
    let p = Object.assign({}, ...prop);
    delete p.target;
    delete p.type;
    vue.$emit(name, p);
   };
}

const EmitError = function(vue, error){
  vue.$emit('onError', error);
}

const GetEncodedURN = function(urn){
  let encoded;
  if(urn.indexOf('adsk') != -1){
    encoded = `urn:${atob(urn)}`;
  }
  else if(urn.indexOf('urn') == -1){
    encoded = `urn:${urn}`;
  }
  else{
    encoded = urn;
  }

  return encoded;
}

/**
 * Creates a new ViewerService object to handle viewer interaction
 * @param {Object} Autodesk Forge Viewer Autodesk SDK
 * @param {Object} VueInstance Vue Instance
 */
const ViewerService = function(Autodesk, VueInstance) {

  // Autodesk Viewing object
  this.AutodeskViewing = Autodesk.Viewing;

  // Autodesk.Vieweing.Extensions function
  this.Extension = Autodesk.Viewing.Extension;

  // Events is an object storing the vue name of the event
  // and the function applied to Viewer3D, so it can be removed later on.
  this.Events;

  // Vue instance, store to be able to emit events
  this.VueInstance = VueInstance;

  // Viewer3D instance
  this.Viewer3D = null;

  // Custom Extensions
  this.CustomExtensions;

  this.ViewerContainer;

  // If any event, try to add it to the Viewer instance
  let events = Object.keys(this.VueInstance.$listeners);
  this.SetEvents(events);
}

/**
 * Initialize the a Viewer instance
 * @param {String} containerId Id of the DOM element to host the viewer
 * @param {Function} getTokenMethod Function to retrieve the token, which will execute a callback
 */
ViewerService.prototype.LaunchViewer = async function (containerId, getTokenMethod) {

  let options = {
    env: 'AutodeskProduction',
    getAccessToken: getTokenMethod
  };

  return new Promise((resolve, reject) => {
    try {
      this.ViewerContainer = document.getElementById(containerId);
      this.AutodeskViewing.Initializer(options, () => {
        resolve(true);
      });
      
    } catch (error) {
      EmitError(this.VueInstance, error);
      reject(error);
    }
  })
}

/**
 * Sets the CustomExtensions object.
 * @param {Object} extensions Object where keys will be the extensions names and values should be functions to initialize new extensions.
 */
ViewerService.prototype.SetCustomExtensions = function(extensions){
  if(Object.values(extensions).some(value => typeof(value) != 'function')){
    throw new Error("Extensions should be an object where its values are valid extension functions.");
  }

  this.CustomExtensions = extensions;
}

/**
 * Determines if the ViewerService has any custom extensions
 * @return {Boolean} True if it has any custom extensions.
 */
ViewerService.prototype.HasCustomExtensions = function(){
  return this.CustomExtensions != null && Object.keys(this.CustomExtensions).length > 0;
}

/**
 * Creates a new Viewer3DConfig with custom extensions, if any
 * @returns {Object} Viewer3DConfig
 */
ViewerService.prototype.GetViewer3DConfig = function(){
  let config3d = {};

  if(this.HasCustomExtensions()){
    let registered = AddCustomExtensions(this.AutodeskViewing, this.Extension, this.CustomExtensions);
    config3d['extensions'] = registered;
  }

  return config3d;
}

/**
 * Sets, from the VueInstance event names, an object where to later on store
 * emmiters for the corresponding ForgeViewer events.
 * @param {String[]} events All Vue instance event names.
 */
ViewerService.prototype.SetEvents = function(events){

  this.Events = events.filter(name => name.endsWith('-event')).reduce((acc, name) => {
    acc[name] = null;
    return acc;
  }, {});

}

/**
 * Loads a document by a given urn. If the URN is not base64 encoded, but the id retrieved from the API,
 * it will try to encoded to base64.
 * https://forge.autodesk.com/en/docs/model-derivative/v2/tutorials/prepare-file-for-viewer
 */
ViewerService.prototype.LoadDocument = function(urn){
  let documentId = GetEncodedURN(urn);
  try {
    this.AutodeskViewing.Document.load(documentId, this.onDocumentLoadSuccess.bind(this), this.onDocumentLoadError.bind(this));
  } catch (error) {
    EmitError(this.VueInstance, error);
  }

}

/**
 * Register the View3D events according to those supplied by
 * the Vuer component
 */
ViewerService.prototype.RegisterEvents = function(){

  let eventNames = Object.keys(this.Events);
  if(eventNames.length > 0) {

    for(let i = 0; i < eventNames.length; i++){
      const vueEventname = eventNames[i];
      const viewerEventName = VueToViewer3DEvent(vueEventname);
      const eventType = this.AutodeskViewing[viewerEventName];

      if(eventType != null){
        let emitterFunction = CreateEmitterFunction(this.VueInstance, vueEventname);
        this.Events[vueEventname] = emitterFunction;

        this.Viewer3D.addEventListener(eventType, emitterFunction);
      }else{
        console.log(`Event '${vueEventname}' doesn't exist on Forge Viewer`);
      }
    }

  }
}

ViewerService.prototype.onDocumentLoadSuccess = function(doc) {

  let geometries = doc.getRoot().search({'type':'geometry'});
  if (geometries.length === 0) {
      EmitError(this.VueInstance, new Error('Document contains no geometries.'))
      return;
  }

  // Load the chosen geometry
  var svfUrl = doc.getViewablePath(geometries[0]);
  var modelOptions = {
      sharedPropertyDbPath: doc.getPropertyDbPath()
  };

  // If Viewer3D is null, it needs to be created and started.
  if(this.Viewer3D == null){
    this.Viewer3D = new this.AutodeskViewing.Private.GuiViewer3D(this.ViewerContainer, this.GetViewer3DConfig());
    this.Viewer3D.start(svfUrl, modelOptions, this.onModelLoaded.bind(this), this.onModelLoadError.bind(this));
    this.RegisterEvents();

    // Emitting Viewer3D Started event
    this.VueInstance.$emit('onViewerStarted', this.Viewer3D);
  }
  else{
    this.Viewer3D.tearDown();
    this.Viewer3D.load(svfUrl, modelOptions, this.onModelLoaded.bind(this), this.onModelLoadError.bind(this));
  }

}

ViewerService.prototype.onDocumentLoadError = function (errorCode) {
  this.VueInstance.$emit('onDocumentLoadError', errorCode);
}

ViewerService.prototype.onModelLoaded = function (item) {
  this.VueInstance.$emit('onModelLoaded', item);
}

ViewerService.prototype.onModelLoadError = function (errorCode) {
  this.VueInstance.$emit('onModelLoadError', errorCode);
}

export {ViewerService};