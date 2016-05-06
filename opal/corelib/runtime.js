(function(undefined) {
  // @note
  //   A few conventions for the documentation of this file:
  //   1. Always use "//" (in contrast with "/**/")
  //   2. The syntax used is Yardoc (yardoc.org), which is intended for Ruby (se below)
  //   3. `@param` and `@return` types should be preceded by `JS.` when referring to
  //      JavaScript constructors (e.g. `JS.Function`) otherwise Ruby is assumed.
  //   4. `nil` and `null` being unambiguous refer to the respective
  //      objects/values in Ruby and JavaScript
  //   5. This is still WIP :) so please give feedback and suggestions on how
  //      to improve or for alternative solutions
  //
  //   The way the code is digested before going through Yardoc is a secret kept
  //   in the docs repo (https://github.com/opal/docs/tree/master).

  if (typeof(this.Opal) !== 'undefined') {
    console.warn('Opal already loaded. Loading twice can cause troubles, please fix your setup.');
    return this.Opal;
  }

  var nil;

  // The actual class for BasicObject
  var BasicObject;

  // The actual Object class.
  // The leading underscore is to avoid confusion with window.Object()
  var _Object;

  // The actual Module class
  var Module;

  // The actual Class class
  var Class;

  // Constructor for instances of BasicObject
  function BasicObject_alloc(){}

  // Constructor for instances of Object
  function Object_alloc(){}

  // Constructor for instances of Class
  function Class_alloc(){}

  // Constructor for instances of Module
  function Module_alloc(){}

  // Constructor for instances of NilClass (nil)
  function NilClass_alloc(){}

  // The Opal object that is exposed globally
  var Opal = this.Opal = {};

  // All bridged classes - keep track to donate methods from Object
  var bridges = {};

  // TopScope is used for inheriting constants from the top scope
  var TopScope = function(){};

  // Opal just acts as the top scope
  TopScope.prototype = Opal;

  // To inherit scopes
  Opal.constructor = TopScope;

  // List top scope constants
  Opal.constants = [];

  // This is a useful reference to global object inside ruby files
  Opal.global = this;

  // Configure runtime behavior with regards to require and unsupported fearures
  Opal.config = {
    missing_require_severity: 'error', // error, warning, ignore
    unsupported_features_severity: 'warning' // error, warning, ignore
  }

  // Minify common function calls
  var $hasOwn = Opal.hasOwnProperty;
  var $slice  = Opal.slice = Array.prototype.slice;

  // Nil object id is always 4
  var nil_id = 4;

  // Generates even sequential numbers greater than 4
  // (nil_id) to serve as unique ids for ruby objects
  var unique_id = nil_id;

  // Return next unique id
  Opal.uid = function() {
    unique_id += 2;
    return unique_id;
  };

  // Table holds all class variables
  Opal.cvars = {};

  // Globals table
  Opal.gvars = {};

  // Exit function, this should be replaced by platform specific implementation
  // (See nodejs and phantom for examples)
  Opal.exit = function(status) { if (Opal.gvars.DEBUG) console.log('Exited with status '+status); };

  // keeps track of exceptions for $!
  Opal.exceptions = [];

  // @private
  // Pops an exception from the stack and updates `$!`.
  Opal.pop_exception = function() {
    Opal.gvars["!"] = Opal.exceptions.pop() || nil;
  }


  // Constants
  // ---------

  // Get a constant on the given scope. Every class and module in Opal has a
  // scope used to store, and inherit, constants. For example, the top level
  // `Object` in ruby has a scope accessible as `Opal.Object.$$scope`.
  //
  // To get the `Array` class using this scope, you could use:
  //
  //     Opal.Object.$$scope.get("Array")
  //
  // If a constant with the given name cannot be found, then a dispatch to the
  // class/module's `#const_method` is called, which by default will raise an
  // error.
  //
  // @param name [String] the name of the constant to lookup
  // @return [Object]
  //
  Opal.get = function(name) {
    var constant = this[name];

    if (constant == null) {
      return this.base.$const_get(name);
    }

    return constant;
  };

  // Create a new constants scope for the given class with the given
  // base. Constants are looked up through their parents, so the base
  // scope will be the outer scope of the new klass.
  //
  // @param base_scope [$$scope] the scope in which the new scope should be created
  // @param klass      [Class]
  // @param id         [String, null] the name of the newly created scope
  //
  Opal.create_scope = function(base_scope, klass, id) {
    var const_alloc = function() {};
    var const_scope = const_alloc.prototype = new base_scope.constructor();

    klass.$$scope       = const_scope;
    klass.$$base_module = base_scope.base;

    const_scope.base        = klass;
    const_scope.constructor = const_alloc;
    const_scope.constants   = [];

    if (id) {
      Opal.cdecl(base_scope, id, klass);
      const_alloc.displayName = id+"_scope_alloc";
    }
  };

  // Constant assignment, see also `Opal.cdecl`
  //
  // @param base_module [Module, Class] the constant namespace
  // @param name        [String] the name of the constant
  // @param value       [Object] the value of the constant
  //
  // @example Assigning a namespaced constant
  //   self::FOO = 'bar'
  //
  // @example Assigning with Module#const_set
  //   Foo.const_set :BAR, 123
  //
  Opal.casgn = function(base_module, name, value) {
    function update(klass, name) {
      klass.$$name = name;

      for (name in klass.$$scope) {
        var value = klass.$$scope[name];

        if (value.$$name === nil && (value.$$is_class || value.$$is_module)) {
          update(value, name)
        }
      }
    }

    var scope = base_module.$$scope;

    if (value.$$is_class || value.$$is_module) {
      // Only checking _Object prevents setting a const on an anonymous class
      // that has a superclass that's not Object
      if (value.$$is_class || value.$$base_module === _Object) {
        value.$$base_module = base_module;
      }

      if (value.$$name === nil && value.$$base_module.$$name !== nil) {
        update(value, name);
      }
    }

    scope.constants.push(name);
    scope[name] = value;

    // If we dynamically declare a constant in a module,
    // we should populate all the classes that include this module
    // with the same constant
    if (base_module.$$is_module && base_module.$$dep) {
      for (var i = 0; i < base_module.$$dep.length; i++) {
        var dep = base_module.$$dep[i];
        Opal.casgn(dep, name, value);
      }
    }

    return value;
  };

  // Constant declaration
  //
  // @example
  //   FOO = :bar
  //
  // @param base_scope [$$scope] the current scope
  // @param name       [String] the name of the constant
  // @param value      [Object] the value of the constant
  Opal.cdecl = function(base_scope, name, value) {
    if ((value.$$is_class || value.$$is_module) && value.$$orig_scope == null) {
      value.$$name = name;
      value.$$orig_scope = base_scope;
      // Here we should explicitly set a base module
      // (a module where the constant was initially defined)
      value.$$base_module = base_scope.base;
      base_scope.constructor[name] = value;
    }

    base_scope.constants.push(name);
    return base_scope[name] = value;
  };


  // Modules & Classes
  // -----------------

  // A `class Foo; end` expression in ruby is compiled to call this runtime
  // method which either returns an existing class of the given name, or creates
  // a new class in the given `base` scope.
  //
  // If a constant with the given name exists, then we check to make sure that
  // it is a class and also that the superclasses match. If either of these
  // fail, then we raise a `TypeError`. Note, `superclass` may be null if one
  // was not specified in the ruby code.
  //
  // We pass a constructor to this method of the form `function ClassName() {}`
  // simply so that classes show up with nicely formatted names inside debuggers
  // in the web browser (or node/sprockets).
  //
  // The `base` is the current `self` value where the class is being created
  // from. We use this to get the scope for where the class should be created.
  // If `base` is an object (not a class/module), we simple get its class and
  // use that as the base instead.
  //
  // @param base        [Object] where the class is being created
  // @param superclass  [Class,null] superclass of the new class (may be null)
  // @param id          [String] the name of the class to be created
  // @param constructor [JS.Function] function to use as constructor
  //
  // @return new [Class]  or existing ruby class
  //
  Opal.klass = function(base, superclass, name, constructor) {
    var klass, bridged, alloc;

    // If base is an object, use its class
    if (!base.$$is_class && !base.$$is_module) {
      base = base.$$class;
    }

    // If the superclass is a function then we're bridging a native JS class
    if (typeof(superclass) === 'function') {
      bridged = superclass;
      superclass = _Object;
    }

    // Try to find the class in the current scope
    klass = base.$$scope[name];

    // If the class exists in the scope, then we must use that
    if (klass && klass.$$orig_scope === base.$$scope) {
      // Make sure the existing constant is a class, or raise error
      if (!klass.$$is_class) {
        throw Opal.TypeError.$new(name + " is not a class");
      }

      // Make sure existing class has same superclass
      if (superclass && klass.$$super !== superclass) {
        throw Opal.TypeError.$new("superclass mismatch for class " + name);
      }

      return klass;
    }

    // Class doesnt exist, create a new one with given superclass...

    // Not specifying a superclass means we can assume it to be Object
    if (superclass == null) {
      superclass = _Object;
    }

    // If bridged the JS class will also be the alloc function
    alloc = bridged || Opal.boot_class_alloc(name, constructor, superclass);

    // Create the class object (instance of Class)
    klass = Opal.setup_class_object(name, alloc, superclass.$$name, superclass.constructor);

    // @property $$super the superclass, doesn't get changed by module inclusions
    klass.$$super = superclass;

    // @property $$parent direct parent class
    //                    starts with the superclass, after klass inclusion is
    //                    the last included klass
    klass.$$parent = superclass;

    // Every class gets its own constant scope, inherited from current scope
    Opal.create_scope(base.$$scope, klass, name);

    // Name new class directly onto current scope (Opal.Foo.Baz = klass)
    base[name] = klass;

    if (bridged) {
      Opal.bridge(klass, alloc);
    }
    else {
      // Copy all parent constants to child, unless parent is Object
      if (superclass !== _Object && superclass !== BasicObject) {
        Opal.donate_constants(superclass, klass);
      }

      // Call .inherited() hook with new class on the superclass
      if (superclass.$inherited) {
        superclass.$inherited(klass);
      }
    }

    return klass;
  };

  // Boot a base class (makes instances).
  //
  // @param name [String,null] the class name
  // @param constructor [JS.Function] the class' instances constructor/alloc function
  // @param superclass  [Class,null] the superclass object
  // @return [JS.Function] the consturctor holding the prototype for the class' instances
  Opal.boot_class_alloc = function(name, constructor, superclass) {
    if (superclass) {
      var alloc_proxy = function() {};
      alloc_proxy.prototype  = superclass.$$proto || superclass.prototype;
      constructor.prototype = new alloc_proxy();
    }

    if (name) {
      constructor.displayName = name+'_alloc';
    }

    constructor.prototype.constructor = constructor;

    return constructor;
  };

  // Adds common/required properties to class object (as in `Class.new`)
  //
  // @param name  [String,null] The name of the class
  //
  // @param alloc [JS.Function] The constructor of the class' instances
  //
  // @param superclass_name [String,null]
  //   The name of the super class, this is
  //   usefule to build the `.displayName` of the singleton class
  //
  // @param superclass_alloc [JS.Function]
  //   The constructor of the superclass from which the singleton_class is
  //   derived.
  //
  // @return [Class]
  Opal.setup_class_object = function(name, alloc, superclass_name, superclass_alloc) {
    // Grab the superclass prototype and use it to build an intermediary object
    // in the prototype chain.
    var superclass_alloc_proxy = function() {};
        superclass_alloc_proxy.prototype = superclass_alloc.prototype;
        superclass_alloc_proxy.displayName = superclass_name;

    var singleton_class_alloc = function() {}
        singleton_class_alloc.prototype = new superclass_alloc_proxy();

    // The built class is the only instance of its singleton_class
    var klass = new singleton_class_alloc();

    // @property $$alloc This is the constructor of instances of the current
    //                   class. Its prototype will be used for method lookup
    klass.$$alloc = alloc;

    klass.$$name = name || nil;

    // @property $$id Each class is assigned a unique `id` that helps
    //                comparation and implementation of `#object_id`
    klass.$$id = Opal.uid();

    // Set a displayName for the singleton_class
    singleton_class_alloc.displayName = "#<Class:"+(name || ("#<Class:"+klass.$$id+">"))+">";

    // @property $$proto This is the prototype on which methods will be defined
    klass.$$proto = alloc.prototype;

    // @property $$proto.$$class Make available to instances a reference to the
    //                           class they belong to.
    klass.$$proto.$$class = klass;

    // @property constructor keeps a ref to the constructor, but apparently the
    //                       constructor is already set on:
    //
    //                          `var klass = new constructor` is called.
    //
    //                       Maybe there are some browsers not abiding (IE6?)
    klass.constructor = singleton_class_alloc;

    // @property $$is_class Clearly mark this as a class
    klass.$$is_class = true;

    // @property $$class Classes are instances of the class Class
    klass.$$class    = Class;

    // @property $$inc included modules
    klass.$$inc = [];

    return klass;
  };

  // Define new module (or return existing module). The given `base` is basically
  // the current `self` value the `module` statement was defined in. If this is
  // a ruby module or class, then it is used, otherwise if the base is a ruby
  // object then that objects real ruby class is used (e.g. if the base is the
  // main object, then the top level `Object` class is used as the base).
  //
  // If a module of the given name is already defined in the base, then that
  // instance is just returned.
  //
  // If there is a class of the given name in the base, then an error is
  // generated instead (cannot have a class and module of same name in same base).
  //
  // Otherwise, a new module is created in the base with the given name, and that
  // new instance is returned back (to be referenced at runtime).
  //
  // @param  base [Module, Class] class or module this definition is inside
  // @param  id   [String] the name of the new (or existing) module
  //
  // @return [Module]
  Opal.module = function(base, name) {
    var module;

    if (!base.$$is_class && !base.$$is_module) {
      base = base.$$class;
    }

    if ($hasOwn.call(base.$$scope, name)) {
      module = base.$$scope[name];

      if (!module.$$is_module && module !== _Object) {
        throw Opal.TypeError.$new(name + " is not a module");
      }
    }
    else {
      module = Opal.module_allocate();
      Opal.create_scope(base.$$scope, module, name);
    }

    return module;
  };

  // The implementation for Module#initialize
  // @param module [Module]
  // @param block [Proc,nil]
  // @return nil
  Opal.module_initialize = function(module, block) {
    if (block !== nil) {
      var block_self = block.$$s;
      block.$$s = null;
      block.call(module);
      block.$$s = block_self;
    }
    return nil;
  };

  // Internal function to create a new module instance. This simply sets up
  // the prototype hierarchy and method tables.
  //
  Opal.module_allocate = function() {
    var mtor = function() {};
    mtor.prototype = Module_alloc.prototype;

    function module_constructor() {}
    module_constructor.prototype = new mtor();

    var module = new module_constructor();
    var module_prototype = {};
    var superclass = Module;

    // @property $$id Each class is assigned a unique `id` that helps
    //                comparation and implementation of `#object_id`
    module.$$id = Opal.uid();

    // Set the display name of the singleton prototype holder
    module_constructor.displayName = "#<Class:#<Module:"+module.$$id+">>"

    // @property $$proto This is the prototype on which methods will be defined
    module.$$proto = module_prototype;

    // @property constructor
    //   keeps a ref to the constructor, but apparently the
    //   constructor is already set on:
    //
    //      `var module = new constructor` is called.
    //
    //   Maybe there are some browsers not abiding (IE6?)
    module.constructor = module_constructor;

    // @property $$is_module Clearly mark this as a module
    module.$$is_module = true;
    module.$$class     = Module;

    // @property $$super
    //   the superclass, doesn't get changed by module inclusions
    module.$$super = superclass;

    // @property $$parent
    //   direct parent class or module
    //   starts with the superclass, after module inclusion is
    //   the last included module
    module.$$parent = superclass;

    // @property $$inc included modules
    module.$$inc = [];

    // mark the object as a module
    module.$$is_module = true;

    // initialize dependency tracking
    module.$$dep = [];

    // initialize the name with nil
    module.$$name = nil;

    return module;
  };

  // Return the singleton class for the passed object.
  //
  // If the given object alredy has a singleton class, then it will be stored on
  // the object as the `$$meta` property. If this exists, then it is simply
  // returned back.
  //
  // Otherwise, a new singleton object for the class or object is created, set on
  // the object at `$$meta` for future use, and then returned.
  //
  // @param object [Object] the ruby object
  // @return [Class] the singleton class for object
  Opal.get_singleton_class = function(object) {
    if (object.$$meta) {
      return object.$$meta;
    }

    if (object.$$is_class || object.$$is_module) {
      return Opal.build_class_singleton_class(object);
    }

    return Opal.build_object_singleton_class(object);
  };

  // Build the singleton class for an existing class. Class object are built
  // with their singleton class already in the prototype chain and inheriting
  // from their superclass object (up to `Class` itself).
  //
  // NOTE: Actually in MRI a class' singleton class inherits from its
  // superclass' singleton class which in turn inherits from Class.
  //
  // @param klass [Class]
  // @return [Class]
  Opal.build_class_singleton_class = function(object) {
    var alloc, superclass, klass;

    if (object.$$meta) {
      return object.$$meta;
    }

    // The constructor and prototype of the singleton_class instances is the
    // current class constructor and prototype.
    alloc = object.constructor;

    // The singleton_class superclass is the singleton_class of its superclass;
    // but BasicObject has no superclass (its `$$super` is null), thus we
    // fallback on `Class`.
    superclass = object === BasicObject ? Class : Opal.build_class_singleton_class(object.$$super);

    klass = Opal.setup_class_object(null, alloc, superclass.$$name, superclass.constructor);
    klass.$$super = superclass;
    klass.$$parent = superclass;

    // The singleton_class retains the same scope as the original class
    Opal.create_scope(object.$$scope, klass);

    klass.$$is_singleton = true;
    klass.$$singleton_of = object;

    return object.$$meta = klass;
  };

  // Build the singleton class for a Ruby (non class) Object.
  //
  // @param object [Object]
  // @return [Class]
  Opal.build_object_singleton_class = function(object) {
    var superclass = object.$$class,
        name = "#<Class:#<" + superclass.$$name + ":" + superclass.$$id + ">>";

    var alloc = Opal.boot_class_alloc(name, function(){}, superclass)
    var klass = Opal.setup_class_object(name, alloc, superclass.$$name, superclass.constructor);

    klass.$$super  = superclass;
    klass.$$parent = superclass;
    klass.$$class  = superclass.$$class;
    klass.$$scope  = superclass.$$scope;
    klass.$$proto  = object;

    klass.$$is_singleton = true;
    klass.$$singleton_of = object;

    return object.$$meta = klass;
  };

  // Bridges a single method.
  Opal.bridge_method = function(target, from, name, body) {
    var ancestors, i, ancestor, length;

    ancestors = target.$$bridge.$ancestors();

    // order important here, we have to check for method presence in
    // ancestors from the bridged class to the last ancestor
    for (i = 0, length = ancestors.length; i < length; i++) {
      ancestor = ancestors[i];

      if ($hasOwn.call(ancestor.$$proto, name) &&
          ancestor.$$proto[name] &&
          !ancestor.$$proto[name].$$donated &&
          !ancestor.$$proto[name].$$stub &&
          ancestor !== from) {
        break;
      }

      if (ancestor === from) {
        target.prototype[name] = body
        break;
      }
    }

  };

  // Bridges from *donator* to a *target*.
  Opal._bridge = function(target, donator) {
    var id, methods, method, i, bridged;

    if (typeof(target) === "function") {
      id      = donator.$__id__();
      methods = donator.$instance_methods();

      for (i = methods.length - 1; i >= 0; i--) {
        method = '$' + methods[i];

        Opal.bridge_method(target, donator, method, donator.$$proto[method]);
      }

      if (!bridges[id]) {
        bridges[id] = [];
      }

      bridges[id].push(target);
    }
    else {
      bridged = bridges[target.$__id__()];

      if (bridged) {
        for (i = bridged.length - 1; i >= 0; i--) {
          Opal._bridge(bridged[i], donator);
        }

        bridges[donator.$__id__()] = bridged.slice();
      }
    }
  };

  // The actual inclusion of a module into a class.
  //
  // ## Class `$$parent` and `iclass`
  //
  // To handle `super` calls, every class has a `$$parent`. This parent is
  // used to resolve the next class for a super call. A normal class would
  // have this point to its superclass. However, if a class includes a module
  // then this would need to take into account the module. The module would
  // also have to then point its `$$parent` to the actual superclass. We
  // cannot modify modules like this, because it might be included in more
  // then one class. To fix this, we actually insert an `iclass` as the class'
  // `$$parent` which can then point to the superclass. The `iclass` acts as
  // a proxy to the actual module, so the `super` chain can then search it for
  // the required method.
  //
  // @param module [Module] the module to include
  // @param klass  [Class] the target class to include module into
  // @return [null]
  Opal.append_features = function(module, klass) {
    var iclass, donator, prototype, methods, id, i;

    // check if this module is already included in the class
    for (i = klass.$$inc.length - 1; i >= 0; i--) {
      if (klass.$$inc[i] === module) {
        return;
      }
    }

    klass.$$inc.push(module);
    module.$$dep.push(klass);
    Opal._bridge(klass, module);

    // iclass
    iclass = {
      $$name:   module.$$name,
      $$proto:  module.$$proto,
      $$parent: klass.$$parent,
      $$module: module,
      $$iclass: true
    };

    klass.$$parent = iclass;

    donator   = module.$$proto;
    prototype = klass.$$proto;
    methods   = module.$instance_methods();

    for (i = methods.length - 1; i >= 0; i--) {
      id = '$' + methods[i];

      // if the target class already has a method of the same name defined
      // and that method was NOT donated, then it must be a method defined
      // by the class so we do not want to override it
      if ( prototype.hasOwnProperty(id) &&
          !prototype[id].$$donated &&
          !prototype[id].$$stub) {
        continue;
      }

      prototype[id] = donator[id];
      prototype[id].$$donated = module;
    }

    Opal.donate_constants(module, klass);
  };

  // Table that holds all methods that have been defined on all objects
  // It is used for defining method stubs for new coming native classes
  Opal.stubs = {};

  // For performance, some core Ruby classes are toll-free bridged to their
  // native JavaScript counterparts (e.g. a Ruby Array is a JavaScript Array).
  //
  // This method is used to setup a native constructor (e.g. Array), to have
  // its prototype act like a normal Ruby class. Firstly, a new Ruby class is
  // created using the native constructor so that its prototype is set as the
  // target for th new class. Note: all bridged classes are set to inherit
  // from Object.
  //
  // Example:
  //
  //    Opal.bridge(self, Function);
  //
  // @param klass       [Class] the Ruby class to bridge
  // @param constructor [JS.Function] native JavaScript constructor to use
  // @return [Class] returns the passed Ruby class
  //
  Opal.bridge = function(klass, constructor) {
    if (constructor.$$bridge) {
      throw Opal.ArgumentError.$new("already bridged");
    }

    Opal.stub_subscribers.push(constructor.prototype);

    // Populate constructor with previously stored stubs
    for (var method_name in Opal.stubs) {
      if (!(method_name in constructor.prototype)) {
        constructor.prototype[method_name] = Opal.stub_for(method_name);
      }
    }

    constructor.prototype.$$class = klass;
    constructor.$$bridge          = klass;

    var ancestors = klass.$ancestors();

    // order important here, we have to bridge from the last ancestor to the
    // bridged class
    for (var i = ancestors.length - 1; i >= 0; i--) {
      Opal._bridge(constructor, ancestors[i]);
    }

    for (var name in BasicObject_alloc.prototype) {
      var method = BasicObject_alloc.prototype[method];

      if (method && method.$$stub && !(name in constructor.prototype)) {
        constructor.prototype[name] = method;
      }
    }

    return klass;
  };

  // When a source module is included into the target module, we must also copy
  // its constants to the target.
  //
  Opal.donate_constants = function(source_mod, target_mod) {
    var source_constants = source_mod.$$scope.constants,
        target_scope     = target_mod.$$scope,
        target_constants = target_scope.constants;

    for (var i = 0, length = source_constants.length; i < length; i++) {
      target_constants.push(source_constants[i]);
      target_scope[source_constants[i]] = source_mod.$$scope[source_constants[i]];
    }
  };

  // Donate methods for a module.
  Opal.donate = function(module, jsid) {
    var included_in = module.$$dep,
        body = module.$$proto[jsid],
        i, length, includee, dest, current,
        klass_includees, j, jj, current_owner_index, module_index;

    if (!included_in) {
      return;
    }

    for (i = 0, length = included_in.length; i < length; i++) {
      includee = included_in[i];
      dest = includee.$$proto;
      current = dest[jsid];

      if (dest.hasOwnProperty(jsid) && !current.$$donated && !current.$$stub) {
        // target class has already defined the same method name - do nothing
      }
      else if (dest.hasOwnProperty(jsid) && !current.$$stub) {
        // target class includes another module that has defined this method
        klass_includees = includee.$$inc;

        for (j = 0, jj = klass_includees.length; j < jj; j++) {
          if (klass_includees[j] === current.$$donated) {
            current_owner_index = j;
          }
          if (klass_includees[j] === module) {
            module_index = j;
          }
        }

        // only redefine method on class if the module was included AFTER
        // the module which defined the current method body. Also make sure
        // a module can overwrite a method it defined before
        if (current_owner_index <= module_index) {
          dest[jsid] = body;
          dest[jsid].$$donated = module;
        }
      }
      else {
        // neither a class, or module included by class, has defined method
        dest[jsid] = body;
        dest[jsid].$$donated = module;
      }

      if (includee.$$dep) {
        Opal.donate(includee, jsid);
      }
    }
  };

  // The Array of ancestors for a given module/class
  Opal.ancestors = function(module_or_class) {
    var parent = module_or_class,
        result = [],
        modules;

    while (parent) {
      result.push(parent);
      for (var i=0; i < parent.$$inc.length; i++) {
        modules = Opal.ancestors(parent.$$inc[i]);

        for(var j = 0; j < modules.length; j++) {
          result.push(modules[j]);
        }
      }

      // only the actual singleton class gets included in its ancestry
      // after that, traverse the normal class hierarchy
      if (parent.$$is_singleton && parent.$$singleton_of.$$is_module) {
        parent = parent.$$singleton_of.$$super;
      }
      else {
        parent = parent.$$is_class ? parent.$$super : null;
      }
    }

    return result;
  };


  // Method Missing
  // --------------

  // Methods stubs are used to facilitate method_missing in opal. A stub is a
  // placeholder function which just calls `method_missing` on the receiver.
  // If no method with the given name is actually defined on an object, then it
  // is obvious to say that the stub will be called instead, and then in turn
  // method_missing will be called.
  //
  // When a file in ruby gets compiled to javascript, it includes a call to
  // this function which adds stubs for every method name in the compiled file.
  // It should then be safe to assume that method_missing will work for any
  // method call detected.
  //
  // Method stubs are added to the BasicObject prototype, which every other
  // ruby object inherits, so all objects should handle method missing. A stub
  // is only added if the given property name (method name) is not already
  // defined.
  //
  // Note: all ruby methods have a `$` prefix in javascript, so all stubs will
  // have this prefix as well (to make this method more performant).
  //
  //    Opal.add_stubs(["$foo", "$bar", "$baz="]);
  //
  // All stub functions will have a private `$$stub` property set to true so
  // that other internal methods can detect if a method is just a stub or not.
  // `Kernel#respond_to?` uses this property to detect a methods presence.
  //
  // @param stubs [Array] an array of method stubs to add
  // @return [undefined]
  Opal.add_stubs = function(stubs) {
    var subscriber, subscribers = Opal.stub_subscribers,
        i, ilength = stubs.length,
        j, jlength = subscribers.length,
        method_name, stub;

    for (i = 0; i < ilength; i++) {
      method_name = stubs[i];
      // Save method name to populate other subscribers with this stub
      Opal.stubs[method_name] = true;
      stub = Opal.stub_for(method_name);

      for (j = 0; j < jlength; j++) {
        subscriber = subscribers[j];

        if (!(method_name in subscriber)) {
          subscriber[method_name] = stub;
        }
      }
    }
  };

  // Keep a list of prototypes that want method_missing stubs to be added.
  //
  // @default [Prototype List] BasicObject_alloc.prototype
  //
  Opal.stub_subscribers = [BasicObject_alloc.prototype];

  // Add a method_missing stub function to the given prototype for the
  // given name.
  //
  // @param prototype [Prototype] the target prototype
  // @param stub [String] stub name to add (e.g. "$foo")
  // @return [undefined]
  Opal.add_stub_for = function(prototype, stub) {
    var method_missing_stub = Opal.stub_for(stub);
    prototype[stub] = method_missing_stub;
  };

  // Generate the method_missing stub for a given method name.
  //
  // @param method_name [String] The js-name of the method to stub (e.g. "$foo")
  // @return [undefined]
  Opal.stub_for = function(method_name) {
    function method_missing_stub() {
      // Copy any given block onto the method_missing dispatcher
      this.$method_missing.$$p = method_missing_stub.$$p;

      // Set block property to null ready for the next call (stop false-positives)
      method_missing_stub.$$p = null;

      // call method missing with correct args (remove '$' prefix on method name)
      return this.$method_missing.apply(this, [method_name.slice(1)].concat($slice.call(arguments)));
    }

    method_missing_stub.$$stub = true;

    return method_missing_stub;
  };


  // Methods
  // -------

  // Arity count error dispatcher for methods
  //
  // @param actual [Fixnum] number of arguments given to method
  // @param expected [Fixnum] expected number of arguments
  // @param object [Object] owner of the method +meth+
  // @param meth [String] method name that got wrong number of arguments
  // @raise [ArgumentError]
  Opal.ac = function(actual, expected, object, meth) {
    var inspect = '';
    if (object.$$is_class || object.$$is_module) {
      inspect += object.$$name + '.';
    }
    else {
      inspect += object.$$class.$$name + '#';
    }
    inspect += meth;

    throw Opal.ArgumentError.$new('[' + inspect + '] wrong number of arguments(' + actual + ' for ' + expected + ')');
  };

  // Arity count error dispatcher for blocks
  //
  // @param actual [Fixnum] number of arguments given to block
  // @param expected [Fixnum] expected number of arguments
  // @param context [Object] context of the block definition
  // @raise [ArgumentError]
  Opal.block_ac = function(actual, expected, context) {
    var inspect = "`block in " + context + "'";

    throw Opal.ArgumentError.$new(inspect + ': wrong number of arguments (' + actual + ' for ' + expected + ')');
  }

  // Super dispatcher
  Opal.find_super_dispatcher = function(obj, jsid, current_func, defcheck, defs) {
    var dispatcher;

    if (defs) {
      if (obj.$$is_class || obj.$$is_module) {
        dispatcher = defs.$$super;
      }
      else {
        dispatcher = obj.$$class.$$proto;
      }
    }
    else {
      dispatcher = Opal.find_obj_super_dispatcher(obj, jsid, current_func);
    }

    dispatcher = dispatcher['$' + jsid];

    if (!defcheck && dispatcher.$$stub && Opal.Kernel.$method_missing === obj.$method_missing) {
      // method_missing hasn't been explicitly defined
      throw Opal.NoMethodError.$new('super: no superclass method `'+jsid+"' for "+obj, jsid);
    }

    return dispatcher;
  };

  // Iter dispatcher for super in a block
  Opal.find_iter_super_dispatcher = function(obj, jsid, current_func, defcheck, implicit) {
    var call_jsid = jsid;

    if (!current_func) {
      throw Opal.RuntimeError.$new("super called outside of method");
    }

    if (implicit && current_func.$$define_meth) {
      throw Opal.RuntimeError.$new("implicit argument passing of super from method defined by define_method() is not supported. Specify all arguments explicitly");
    }

    if (current_func.$$def) {
      call_jsid = current_func.$$jsid;
    }

    return Opal.find_super_dispatcher(obj, call_jsid, current_func, defcheck);
  };

  Opal.find_obj_super_dispatcher = function(obj, jsid, current_func) {
    var klass = obj.$$meta || obj.$$class;

    // first we need to find the class/module current_func is located on
    klass = Opal.find_owning_class(klass, current_func);

    if (!klass) {
      throw new Error("could not find current class for super()");
    }

    jsid = '$' + jsid;
    return Opal.find_super_func(klass, jsid, current_func);
  };

  Opal.find_owning_class = function(klass, current_func) {
    var owner = current_func.$$owner;

    while (klass) {
      // repeating for readability

      if (klass.$$iclass && klass.$$module === current_func.$$donated) {
        // this klass was the last one the module donated to
        // case is also hit with multiple module includes
        break;
      }
      else if (klass.$$iclass && klass.$$module === owner) {
        // module has donated to other classes but klass isn't one of those
        break;
      }
      else if (owner.$$is_singleton && klass === owner.$$singleton_of.$$class) {
        // cases like stdlib `Singleton::included` that use a singleton of a singleton
        break;
      }
      else if (klass === owner) {
        // no modules, pure class inheritance
        break;
      }

      klass = klass.$$parent;
    }

    return klass;
  };

  Opal.find_super_func = function(owning_klass, jsid, current_func) {
    var klass = owning_klass.$$parent;

    // now we can find the super
    while (klass) {
      var working = klass.$$proto[jsid];

      if (working && working !== current_func) {
        // ok
        break;
      }

      klass = klass.$$parent;
    }

    return klass.$$proto;
  };

  // Used to return as an expression. Sometimes, we can't simply return from
  // a javascript function as if we were a method, as the return is used as
  // an expression, or even inside a block which must "return" to the outer
  // method. This helper simply throws an error which is then caught by the
  // method. This approach is expensive, so it is only used when absolutely
  // needed.
  //
  Opal.ret = function(val) {
    Opal.returner.$v = val;
    throw Opal.returner;
  };

  // Used to break out of a block.
  Opal.brk = function(val, breaker) {
    breaker.$v = val;
    throw breaker;
  };

  // Builds a new unique breaker, this is to avoid multiple nested breaks to get
  // in the way of each other.
  Opal.new_brk = function() {
    return new Error('unexpected break');
  };

  // handles yield calls for 1 yielded arg
  Opal.yield1 = function(block, arg) {
    if (typeof(block) !== "function") {
      throw Opal.LocalJumpError.$new("no block given");
    }

    var has_mlhs = block.$$has_top_level_mlhs_arg,
        has_trailing_comma = block.$$has_trailing_comma_in_args;

    if (block.length > 1 || ((has_mlhs || has_trailing_comma) && block.length === 1)) {
      arg = Opal.to_ary(arg);
    }

    if ((block.length > 1 || (has_trailing_comma && block.length === 1)) && arg.$$is_array) {
      return block.apply(null, arg);
    }
    else {
      return block(arg);
    }
  };

  // handles yield for > 1 yielded arg
  Opal.yieldX = function(block, args) {
    if (typeof(block) !== "function") {
      throw Opal.LocalJumpError.$new("no block given");
    }

    if (block.length > 1 && args.length === 1) {
      if (args[0].$$is_array) {
        return block.apply(null, args[0]);
      }
    }

    if (!args.$$is_array) {
      args = $slice.call(args);
    }

    return block.apply(null, args);
  };

  // Finds the corresponding exception match in candidates.  Each candidate can
  // be a value, or an array of values.  Returns null if not found.
  Opal.rescue = function(exception, candidates) {
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];

      if (candidate.$$is_array) {
        var result = Opal.rescue(exception, candidate);

        if (result) {
          return result;
        }
      }
      else if (candidate['$==='](exception)) {
        return candidate;
      }
    }

    return null;
  };

  Opal.is_a = function(object, klass) {
    if (object.$$meta === klass) {
      return true;
    }

    var i, length, ancestors = Opal.ancestors(object.$$class);

    for (i = 0, length = ancestors.length; i < length; i++) {
      if (ancestors[i] === klass) {
        return true;
      }
    }

    ancestors = Opal.ancestors(object.$$meta);

    for (i = 0, length = ancestors.length; i < length; i++) {
      if (ancestors[i] === klass) {
        return true;
      }
    }

    return false;
  };

  // Helpers for extracting kwsplats
  // Used for: { **h }
  Opal.to_hash = function(value) {
    if (value.$$is_hash) {
      return value;
    }
    else if (value['$respond_to?']('to_hash', true)) {
      var hash = value.$to_hash();
      if (hash.$$is_hash) {
        return hash;
      }
      else {
        throw Opal.TypeError.$new("Can't convert " + value.$$class +
          " to Hash (" + value.$$class + "#to_hash gives " + hash.$$class + ")");
      }
    }
    else {
      throw Opal.TypeError.$new("no implicit conversion of " + value.$$class + " into Hash");
    }
  };

  // Helpers for implementing multiple assignment
  // Our code for extracting the values and assigning them only works if the
  // return value is a JS array.
  // So if we get an Array subclass, extract the wrapped JS array from it

  // Used for: a, b = something (no splat)
  Opal.to_ary = function(value) {
    if (value.$$is_array) {
      return value;
    }
    else if (value['$respond_to?']('to_ary', true)) {
      var ary = value.$to_ary();
      if (ary === nil) {
        return [value];
      }
      else if (ary.$$is_array) {
        return ary;
      }
      else {
        throw Opal.TypeError.$new("Can't convert " + value.$$class +
          " to Array (" + value.$$class + "#to_ary gives " + ary.$$class + ")");
      }
    }
    else {
      return [value];
    }
  };

  // Used for: a, b = *something (with splat)
  Opal.to_a = function(value) {
    if (value.$$is_array) {
      // A splatted array must be copied
      return value.slice();
    }
    else if (value['$respond_to?']('to_a', true)) {
      var ary = value.$to_a();
      if (ary === nil) {
        return [value];
      }
      else if (ary.$$is_array) {
        return ary;
      }
      else {
        throw Opal.TypeError.$new("Can't convert " + value.$$class +
          " to Array (" + value.$$class + "#to_a gives " + ary.$$class + ")");
      }
    }
    else {
      return [value];
    }
  };

  // Used for extracting keyword arguments from arguments passed to
  // JS function. If provided +arguments+ list doesn't have a Hash
  // as a last item, returns a blank Hash.
  //
  // @param parameters [Array]
  // @return [Hash]
  //
  Opal.extract_kwargs = function(parameters) {
    var kwargs = parameters[parameters.length - 1];
    if (kwargs != null && kwargs['$respond_to?']('to_hash', true)) {
      Array.prototype.splice.call(parameters, parameters.length - 1, 1);
      return kwargs.$to_hash();
    }
    else {
      return Opal.hash2([], {});
    }
  }

  // Used to get a list of rest keyword arguments. Method takes the given
  // keyword args, i.e. the hash literal passed to the method containing all
  // keyword arguemnts passed to method, as well as the used args which are
  // the names of required and optional arguments defined. This method then
  // just returns all key/value pairs which have not been used, in a new
  // hash literal.
  //
  // @param given_args [Hash] all kwargs given to method
  // @param used_args [Object<String: true>] all keys used as named kwargs
  // @return [Hash]
  //
  Opal.kwrestargs = function(given_args, used_args) {
    var keys      = [],
        map       = {},
        key       = null,
        given_map = given_args.$$smap;

    for (key in given_map) {
      if (!used_args[key]) {
        keys.push(key);
        map[key] = given_map[key];
      }
    }

    return Opal.hash2(keys, map);
  };

  // Call a ruby method on a ruby object with some arguments:
  //
  // @example
  //   var my_array = [1, 2, 3, 4]
  //   Opal.send(my_array, 'length')     # => 4
  //   Opal.send(my_array, 'reverse!')   # => [4, 3, 2, 1]
  //
  // A missing method will be forwarded to the object via
  // method_missing.
  //
  // The result of either call with be returned.
  //
  // @param recv [Object] the ruby object
  // @param mid  [String] ruby method to call
  // @return [Object] forwards the return value of the method (or of method_missing)
  Opal.send = function(recv, mid) {
    var args = $slice.call(arguments, 2),
        func = recv['$' + mid];

    if (func) {
      return func.apply(recv, args);
    }

    return recv.$method_missing.apply(recv, [mid].concat(args));
  };

  Opal.block_send = function(recv, mid, block) {
    var args = $slice.call(arguments, 3),
        func = recv['$' + mid];

    if (func) {
      func.$$p = block;
      return func.apply(recv, args);
    }

    return recv.$method_missing.apply(recv, [mid].concat(args));
  };

  // Used to define methods on an object. This is a helper method, used by the
  // compiled source to define methods on special case objects when the compiler
  // can not determine the destination object, or the object is a Module
  // instance. This can get called by `Module#define_method` as well.
  //
  // ## Modules
  //
  // Any method defined on a module will come through this runtime helper.
  // The method is added to the module body, and the owner of the method is
  // set to be the module itself. This is used later when choosing which
  // method should show on a class if more than 1 included modules define
  // the same method. Finally, if the module is in `module_function` mode,
  // then the method is also defined onto the module itself.
  //
  // ## Classes
  //
  // This helper will only be called for classes when a method is being
  // defined indirectly; either through `Module#define_method`, or by a
  // literal `def` method inside an `instance_eval` or `class_eval` body. In
  // either case, the method is simply added to the class' prototype. A special
  // exception exists for `BasicObject` and `Object`. These two classes are
  // special because they are used in toll-free bridged classes. In each of
  // these two cases, extra work is required to define the methods on toll-free
  // bridged class' prototypes as well.
  //
  // ## Objects
  //
  // If a simple ruby object is the object, then the method is simply just
  // defined on the object as a singleton method. This would be the case when
  // a method is defined inside an `instance_eval` block.
  //
  // @param obj  [Object, Class] the actual obj to define method for
  // @param jsid [String] the JavaScript friendly method name (e.g. '$foo')
  // @param body [JS.Function] the literal JavaScript function used as method
  // @return [null]
  //
  Opal.defn = function(obj, jsid, body) {
    obj.$$proto[jsid] = body;
    // for super dispatcher, etc.
    body.$$owner = obj;

    if (obj.$$is_module) {
      Opal.donate(obj, jsid);

      if (obj.$$module_function) {
        Opal.defs(obj, jsid, body);
      }
    }

    if (obj.$__id__ && !obj.$__id__.$$stub) {
      var bridged = bridges[obj.$__id__()];

      if (bridged) {
        for (var i = bridged.length - 1; i >= 0; i--) {
          Opal.bridge_method(bridged[i], obj, jsid, body);
        }
      }
    }

    var singleton_of = obj.$$singleton_of;
    if (obj.$method_added && !obj.$method_added.$$stub && !singleton_of) {
      obj.$method_added(jsid.substr(1));
    }
    else if (singleton_of && singleton_of.$singleton_method_added && !singleton_of.$singleton_method_added.$$stub) {
      singleton_of.$singleton_method_added(jsid.substr(1));
    }

    return nil;
  };

  // Define a singleton method on the given object.
  Opal.defs = function(obj, jsid, body) {
    Opal.defn(Opal.get_singleton_class(obj), jsid, body)
  };

  Opal.def = function(obj, jsid, body) {
    // if instance_eval is invoked on a module/class, it sets inst_eval_mod
    if (!obj.$$eval && (obj.$$is_class || obj.$$is_module)) {
      Opal.defn(obj, jsid, body);
    }
    else {
      Opal.defs(obj, jsid, body);
    }
  };

  // Called from #remove_method.
  Opal.rdef = function(obj, jsid) {
    // TODO: remove from bridges as well

    if (!$hasOwn.call(obj.$$proto, jsid)) {
      throw Opal.NameError.$new("method '" + jsid.substr(1) + "' not defined in " + obj.$name());
    }

    delete obj.$$proto[jsid];

    if (obj.$$is_singleton) {
      if (obj.$$proto.$singleton_method_removed && !obj.$$proto.$singleton_method_removed.$$stub) {
        obj.$$proto.$singleton_method_removed(jsid.substr(1));
      }
    }
    else {
      if (obj.$method_removed && !obj.$method_removed.$$stub) {
        obj.$method_removed(jsid.substr(1));
      }
    }
  };

  // Called from #undef_method.
  Opal.udef = function(obj, jsid) {
    if (!obj.$$proto[jsid] || obj.$$proto[jsid].$$stub) {
      throw Opal.NameError.$new("method '" + jsid.substr(1) + "' not defined in " + obj.$name());
    }

    Opal.add_stub_for(obj.$$proto, jsid);

    if (obj.$$is_singleton) {
      if (obj.$$proto.$singleton_method_undefined && !obj.$$proto.$singleton_method_undefined.$$stub) {
        obj.$$proto.$singleton_method_undefined(jsid.substr(1));
      }
    }
    else {
      if (obj.$method_undefined && !obj.$method_undefined.$$stub) {
        obj.$method_undefined(jsid.substr(1));
      }
    }
  };

  Opal.alias = function(obj, name, old) {
    var id     = '$' + name,
        old_id = '$' + old,
        body   = obj.$$proto['$' + old];

    // instance_eval is being run on a class/module, so that need to alias class methods
    if (obj.$$eval) {
      return Opal.alias(Opal.get_singleton_class(obj), name, old);
    }

    if (typeof(body) !== "function" || body.$$stub) {
      var ancestor = obj.$$super;

      while (typeof(body) !== "function" && ancestor) {
        body     = ancestor[old_id];
        ancestor = ancestor.$$super;
      }

      if (typeof(body) !== "function" || body.$$stub) {
        throw Opal.NameError.$new("undefined method `" + old + "' for class `" + obj.$name() + "'")
      }
    }

    Opal.defn(obj, id, body);

    return obj;
  };

  Opal.alias_native = function(obj, name, native_name) {
    var id   = '$' + name,
        body = obj.$$proto[native_name];

    if (typeof(body) !== "function" || body.$$stub) {
      throw Opal.NameError.$new("undefined native method `" + native_name + "' for class `" + obj.$name() + "'")
    }

    Opal.defn(obj, id, body);

    return obj;
  };


  // Hashes
  // ------

  Opal.hash_init = function(hash) {
    hash.$$smap = {};
    hash.$$map  = {};
    hash.$$keys = [];
  };

  Opal.hash_clone = function(from_hash, to_hash) {
    to_hash.$$none = from_hash.$$none;
    to_hash.$$proc = from_hash.$$proc;

    for (var i = 0, keys = from_hash.$$keys, length = keys.length, key, value; i < length; i++) {
      key = from_hash.$$keys[i];

      if (key.$$is_string) {
        value = from_hash.$$smap[key];
      } else {
        value = key.value;
        key = key.key;
      }

      Opal.hash_put(to_hash, key, value);
    }
  };

  Opal.hash_put = function(hash, key, value) {
    if (key.$$is_string) {
      if (!hash.$$smap.hasOwnProperty(key)) {
        hash.$$keys.push(key);
      }
      hash.$$smap[key] = value;
      return;
    }

    var key_hash = key.$hash(), bucket, last_bucket;

    if (!hash.$$map.hasOwnProperty(key_hash)) {
      bucket = {key: key, key_hash: key_hash, value: value};
      hash.$$keys.push(bucket);
      hash.$$map[key_hash] = bucket;
      return;
    }

    bucket = hash.$$map[key_hash];

    while (bucket) {
      if (key === bucket.key || key['$eql?'](bucket.key)) {
        last_bucket = undefined;
        bucket.value = value;
        break;
      }
      last_bucket = bucket;
      bucket = bucket.next;
    }

    if (last_bucket) {
      bucket = {key: key, key_hash: key_hash, value: value};
      hash.$$keys.push(bucket);
      last_bucket.next = bucket;
    }
  };

  Opal.hash_get = function(hash, key) {
    if (key.$$is_string) {
      if (hash.$$smap.hasOwnProperty(key)) {
        return hash.$$smap[key];
      }
      return;
    }

    var key_hash = key.$hash(), bucket;

    if (hash.$$map.hasOwnProperty(key_hash)) {
      bucket = hash.$$map[key_hash];

      while (bucket) {
        if (key === bucket.key || key['$eql?'](bucket.key)) {
          return bucket.value;
        }
        bucket = bucket.next;
      }
    }
  };

  Opal.hash_delete = function(hash, key) {
    var i, keys = hash.$$keys, length = keys.length, value;

    if (key.$$is_string) {
      if (!hash.$$smap.hasOwnProperty(key)) {
        return;
      }

      for (i = 0; i < length; i++) {
        if (keys[i] === key) {
          keys.splice(i, 1);
          break;
        }
      }

      value = hash.$$smap[key];
      delete hash.$$smap[key];
      return value;
    }

    var key_hash = key.$hash();

    if (!hash.$$map.hasOwnProperty(key_hash)) {
      return;
    }

    var bucket = hash.$$map[key_hash], last_bucket;

    while (bucket) {
      if (key === bucket.key || key['$eql?'](bucket.key)) {
        value = bucket.value;

        for (i = 0; i < length; i++) {
          if (keys[i] === bucket) {
            keys.splice(i, 1);
            break;
          }
        }

        if (last_bucket && bucket.next) {
          last_bucket.next = bucket.next;
        }
        else if (last_bucket) {
          delete last_bucket.next;
        }
        else if (bucket.next) {
          hash.$$map[key_hash] = bucket.next;
        }
        else {
          delete hash.$$map[key_hash];
        }

        return value;
      }
      last_bucket = bucket;
      bucket = bucket.next;
    }
  };

  Opal.hash_rehash = function(hash) {
    for (var i = 0, length = hash.$$keys.length, key_hash, bucket, last_bucket; i < length; i++) {

      if (hash.$$keys[i].$$is_string) {
        continue;
      }

      key_hash = hash.$$keys[i].key.$hash();

      if (key_hash === hash.$$keys[i].key_hash) {
        continue;
      }

      bucket = hash.$$map[hash.$$keys[i].key_hash];
      last_bucket = undefined;

      while (bucket) {
        if (bucket === hash.$$keys[i]) {
          if (last_bucket && bucket.next) {
            last_bucket.next = bucket.next;
          }
          else if (last_bucket) {
            delete last_bucket.next;
          }
          else if (bucket.next) {
            hash.$$map[hash.$$keys[i].key_hash] = bucket.next;
          }
          else {
            delete hash.$$map[hash.$$keys[i].key_hash];
          }
          break;
        }
        last_bucket = bucket;
        bucket = bucket.next;
      }

      hash.$$keys[i].key_hash = key_hash;

      if (!hash.$$map.hasOwnProperty(key_hash)) {
        hash.$$map[key_hash] = hash.$$keys[i];
        continue;
      }

      bucket = hash.$$map[key_hash];
      last_bucket = undefined;

      while (bucket) {
        if (bucket === hash.$$keys[i]) {
          last_bucket = undefined;
          break;
        }
        last_bucket = bucket;
        bucket = bucket.next;
      }

      if (last_bucket) {
        last_bucket.next = hash.$$keys[i];
      }
    }
  };

  Opal.hash = function() {
    var arguments_length = arguments.length, args, hash, i, length, key, value;

    if (arguments_length === 1 && arguments[0].$$is_hash) {
      return arguments[0];
    }

    hash = new Opal.Hash.$$alloc();
    Opal.hash_init(hash);

    if (arguments_length === 1 && arguments[0].$$is_array) {
      args = arguments[0];
      length = args.length;

      for (i = 0; i < length; i++) {
        if (args[i].length !== 2) {
          throw Opal.ArgumentError.$new("value not of length 2: " + args[i].$inspect());
        }

        key = args[i][0];
        value = args[i][1];

        Opal.hash_put(hash, key, value);
      }

      return hash;
    }

    if (arguments_length === 1) {
      args = arguments[0];
      for (key in args) {
        if (args.hasOwnProperty(key)) {
          value = args[key];

          Opal.hash_put(hash, key, value);
        }
      }

      return hash;
    }

    if (arguments_length % 2 !== 0) {
      throw Opal.ArgumentError.$new("odd number of arguments for Hash");
    }

    for (i = 0; i < arguments_length; i += 2) {
      key = arguments[i];
      value = arguments[i + 1];

      Opal.hash_put(hash, key, value);
    }

    return hash;
  };

  // hash2 is a faster creator for hashes that just use symbols and
  // strings as keys. The map and keys array can be constructed at
  // compile time, so they are just added here by the constructor
  // function
  //
  Opal.hash2 = function(keys, smap) {
    var hash = new Opal.Hash.$$alloc();

    hash.$$smap = smap;
    hash.$$map  = {};
    hash.$$keys = keys;

    return hash;
  };

  // Create a new range instance with first and last values, and whether the
  // range excludes the last value.
  //
  Opal.range = function(first, last, exc) {
    var range         = new Opal.Range.$$alloc();
        range.begin   = first;
        range.end     = last;
        range.exclude = exc;

    return range;
  };

  Opal.ivar = function(name) {
    if (
        // properties
        name === "constructor" ||
        name === "displayName" ||
        name === "__count__" ||
        name === "__noSuchMethod__" ||
        name === "__parent__" ||
        name === "__proto__" ||

        // methods
        name === "hasOwnProperty" ||
        name === "valueOf"
       )
    {
      return name + "$";
    }

    return name;
  };


  // Require system
  // --------------

  Opal.modules         = {};
  Opal.loaded_features = ['corelib/runtime'];
  Opal.current_dir     = '.'
  Opal.require_table   = {'corelib/runtime': true};

  Opal.normalize = function(path) {
    var parts, part, new_parts = [], SEPARATOR = '/';

    if (Opal.current_dir !== '.') {
      path = Opal.current_dir.replace(/\/*$/, '/') + path;
    }

    path = path.replace(/\.(rb|opal|js)$/, '');
    parts = path.split(SEPARATOR);

    for (var i = 0, ii = parts.length; i < ii; i++) {
      part = parts[i];
      if (part === '') continue;
      (part === '..') ? new_parts.pop() : new_parts.push(part)
    }

    return new_parts.join(SEPARATOR);
  };

  Opal.loaded = function(paths) {
    var i, l, path;

    for (i = 0, l = paths.length; i < l; i++) {
      path = Opal.normalize(paths[i]);

      if (Opal.require_table[path]) {
        return;
      }

      Opal.loaded_features.push(path);
      Opal.require_table[path] = true;
    }
  };

  Opal.load = function(path) {
    path = Opal.normalize(path);

    Opal.loaded([path]);

    var module = Opal.modules[path];

    if (module) {
      module(Opal);
    }
    else {
      var severity = Opal.config.missing_require_severity;
      var message  = 'cannot load such file -- ' + path;

      if (severity === "error") {
        Opal.LoadError ? Opal.LoadError.$new(message) : function(){throw message}();
      }
      else if (severity === "warning") {
        console.warn('WARNING: LoadError: ' + message);
      }
    }

    return true;
  };

  Opal.require = function(path) {
    path = Opal.normalize(path);

    if (Opal.require_table[path]) {
      return false;
    }

    return Opal.load(path);
  };


  // Initialization
  // --------------

  // Constructors for *instances* of core objects
  Opal.boot_class_alloc('BasicObject', BasicObject_alloc);
  Opal.boot_class_alloc('Object',      Object_alloc,       BasicObject_alloc);
  Opal.boot_class_alloc('Module',      Module_alloc,       Object_alloc);
  Opal.boot_class_alloc('Class',       Class_alloc,        Module_alloc);

  // Constructors for *classes* of core objects
  Opal.BasicObject = BasicObject = Opal.setup_class_object('BasicObject', BasicObject_alloc, 'Class',       Class_alloc);
  Opal.Object      = _Object     = Opal.setup_class_object('Object',      Object_alloc,      'BasicObject', BasicObject.constructor);
  Opal.Module      = Module      = Opal.setup_class_object('Module',      Module_alloc,      'Object',      _Object.constructor);
  Opal.Class       = Class       = Opal.setup_class_object('Class',       Class_alloc,       'Module',      Module.constructor);

  Opal.constants.push("BasicObject");
  Opal.constants.push("Object");
  Opal.constants.push("Module");
  Opal.constants.push("Class");

  // Fix booted classes to use their metaclass
  BasicObject.$$class = Class;
  _Object.$$class     = Class;
  Module.$$class      = Class;
  Class.$$class       = Class;

  // Fix superclasses of booted classes
  BasicObject.$$super = null;
  _Object.$$super     = BasicObject;
  Module.$$super      = _Object;
  Class.$$super       = Module;

  BasicObject.$$parent = null;
  _Object.$$parent     = BasicObject;
  Module.$$parent      = _Object;
  Class.$$parent       = Module;

  Opal.base                = _Object;
  BasicObject.$$scope      = _Object.$$scope = Opal;
  BasicObject.$$orig_scope = _Object.$$orig_scope = Opal;

  Module.$$scope      = _Object.$$scope;
  Module.$$orig_scope = _Object.$$orig_scope;
  Class.$$scope       = _Object.$$scope;
  Class.$$orig_scope  = _Object.$$orig_scope;

  // Forward .toString() to #to_s
  _Object.$$proto.toString = function() {
    return this.$to_s();
  };

  // Make Kernel#require immediately available as it's needed to require all the
  // other corelib files.
  _Object.$$proto.$require = Opal.require;

  // Instantiate the top object
  Opal.top = new _Object.$$alloc();

  // Nil
  Opal.klass(_Object, _Object, 'NilClass', NilClass_alloc);
  nil = Opal.nil = new NilClass_alloc();
  nil.$$id = nil_id;
  nil.call = nil.apply = function() { throw Opal.LocalJumpError.$new('no block given'); };
  Opal.breaker  = new Error('unexpected break (old)');
  Opal.returner = new Error('unexpected return');

  TypeError.$$super = Error;
}).call(this);

if (typeof(global) !== 'undefined') {
  global.Opal = this.Opal;
  Opal.global = global;
}

if (typeof(window) !== 'undefined') {
  window.Opal = this.Opal;
  Opal.global = window;
}

/*!
 * XRegExp 3.1.0
 * <xregexp.com>
 * Steven Levithan (c) 2007-2016 MIT License
 */

/**
 * XRegExp provides augmented, extensible regular expressions. You get additional regex syntax and
 * flags, beyond what browsers support natively. XRegExp is also a regex utility belt with tools to
 * make your client-side grepping simpler and more powerful, while freeing you from related
 * cross-browser inconsistencies.
 */

    'use strict';

/* ==============================
 * Private stuff
 * ============================== */

    // Property name used for extended regex instance data
    var REGEX_DATA = 'xregexp';
    // Optional features that can be installed and uninstalled
    var features = {
        astral: false,
        natives: false
    };
    // Native methods to use and restore ('native' is an ES3 reserved keyword)
    var nativ = {
        exec: RegExp.prototype.exec,
        test: RegExp.prototype.test,
        match: String.prototype.match,
        replace: String.prototype.replace,
        split: String.prototype.split
    };
    // Storage for fixed/extended native methods
    var fixed = {};
    // Storage for regexes cached by `XRegExp.cache`
    var regexCache = {};
    // Storage for pattern details cached by the `XRegExp` constructor
    var patternCache = {};
    // Storage for regex syntax tokens added internally or by `XRegExp.addToken`
    var tokens = [];
    // Token scopes
    var defaultScope = 'default';
    var classScope = 'class';
    // Regexes that match native regex syntax, including octals
    var nativeTokens = {
        // Any native multicharacter token in default scope, or any single character
        'default': /\\(?:0(?:[0-3][0-7]{0,2}|[4-7][0-7]?)?|[1-9]\d*|x[\dA-Fa-f]{2}|u(?:[\dA-Fa-f]{4}|{[\dA-Fa-f]+})|c[A-Za-z]|[\s\S])|\(\?[:=!]|[?*+]\?|{\d+(?:,\d*)?}\??|[\s\S]/,
        // Any native multicharacter token in character class scope, or any single character
        'class': /\\(?:[0-3][0-7]{0,2}|[4-7][0-7]?|x[\dA-Fa-f]{2}|u(?:[\dA-Fa-f]{4}|{[\dA-Fa-f]+})|c[A-Za-z]|[\s\S])|[\s\S]/
    };
    // Any backreference or dollar-prefixed character in replacement strings
    var replacementToken = /\$(?:{([\w$]+)}|(\d\d?|[\s\S]))/g;
    // Check for correct `exec` handling of nonparticipating capturing groups
    var correctExecNpcg = nativ.exec.call(/()??/, '')[1] === undefined;
    // Check for ES6 `flags` prop support
    var hasFlagsProp = /x/.flags !== undefined;
    // Shortcut to `Object.prototype.toString`
    var toString = {}.toString;

    function hasNativeFlag(flag) {
        // Can't check based on the presense of properties/getters since
        // browsers might support such properties even when don't support the
        // corresponding flag in regex construction (tested in Chrome 48, where
        // `'unicode' in /x/` is true but trying to construct a regex with flag
        // `u` throws an error).
        var isSupported = true;
        try {
            new RegExp('', flag);
        } catch (exception) {
            isSupported = false;
        }
        return isSupported;
    }
    // Check for ES6 `u` flag support
    var hasNativeU = hasNativeFlag('u');
    // Check for ES6 `y` flag support
    var hasNativeY = hasNativeFlag('y');
    // Tracker for known flags, including addon flags
    var registeredFlags = {
        g: true,
        i: true,
        m: true,
        u: hasNativeU,
        y: hasNativeY
    };

/**
 * Attaches extended data and `XRegExp.prototype` properties to a regex object.
 *
 * @private
 * @param {RegExp} regex Regex to augment.
 * @param {Array} captureNames Array with capture names, or `null`.
 * @param {String} xSource XRegExp pattern used to generate `regex`, or `null` if N/A.
 * @param {String} xFlags XRegExp flags used to generate `regex`, or `null` if N/A.
 * @param {Boolean} [isInternalOnly=false] Whether the regex will be used only for internal
 *   operations, and never exposed to users. For internal-only regexes, we can improve perf by
 *   skipping some operations like attaching `XRegExp.prototype` properties.
 * @returns {RegExp} Augmented regex.
 */
    function augment(regex, captureNames, xSource, xFlags, isInternalOnly) {
        var p;

        regex[REGEX_DATA] = {
            captureNames: captureNames
        };

        if (isInternalOnly) {
            return regex;
        }

        // Can't auto-inherit these since the XRegExp constructor returns a nonprimitive value
        if (regex.__proto__) {
            regex.__proto__ = XRegExp.prototype;
        } else {
            for (p in XRegExp.prototype) {
                // An `XRegExp.prototype.hasOwnProperty(p)` check wouldn't be worth it here, since
                // this is performance sensitive, and enumerable `Object.prototype` or
                // `RegExp.prototype` extensions exist on `regex.prototype` anyway
                regex[p] = XRegExp.prototype[p];
            }
        }

        regex[REGEX_DATA].source = xSource;
        // Emulate the ES6 `flags` prop by ensuring flags are in alphabetical order
        regex[REGEX_DATA].flags = xFlags ? xFlags.split('').sort().join('') : xFlags;

        return regex;
    }

/**
 * Removes any duplicate characters from the provided string.
 *
 * @private
 * @param {String} str String to remove duplicate characters from.
 * @returns {String} String with any duplicate characters removed.
 */
    function clipDuplicates(str) {
        return nativ.replace.call(str, /([\s\S])(?=[\s\S]*\1)/g, '');
    }

/**
 * Copies a regex object while preserving extended data and augmenting with `XRegExp.prototype`
 * properties. The copy has a fresh `lastIndex` property (set to zero). Allows adding and removing
 * flags g and y while copying the regex.
 *
 * @private
 * @param {RegExp} regex Regex to copy.
 * @param {Object} [options] Options object with optional properties:
 *   <li>`addG` {Boolean} Add flag g while copying the regex.
 *   <li>`addY` {Boolean} Add flag y while copying the regex.
 *   <li>`removeG` {Boolean} Remove flag g while copying the regex.
 *   <li>`removeY` {Boolean} Remove flag y while copying the regex.
 *   <li>`isInternalOnly` {Boolean} Whether the copied regex will be used only for internal
 *     operations, and never exposed to users. For internal-only regexes, we can improve perf by
 *     skipping some operations like attaching `XRegExp.prototype` properties.
 * @returns {RegExp} Copy of the provided regex, possibly with modified flags.
 */
    function copyRegex(regex, options) {
        if (!XRegExp.isRegExp(regex)) {
            throw new TypeError('Type RegExp expected');
        }

        var xData = regex[REGEX_DATA] || {},
            flags = getNativeFlags(regex),
            flagsToAdd = '',
            flagsToRemove = '',
            xregexpSource = null,
            xregexpFlags = null;

        options = options || {};

        if (options.removeG) {flagsToRemove += 'g';}
        if (options.removeY) {flagsToRemove += 'y';}
        if (flagsToRemove) {
            flags = nativ.replace.call(flags, new RegExp('[' + flagsToRemove + ']+', 'g'), '');
        }

        if (options.addG) {flagsToAdd += 'g';}
        if (options.addY) {flagsToAdd += 'y';}
        if (flagsToAdd) {
            flags = clipDuplicates(flags + flagsToAdd);
        }

        if (!options.isInternalOnly) {
            if (xData.source !== undefined) {
                xregexpSource = xData.source;
            }
            // null or undefined; don't want to add to `flags` if the previous value was null, since
            // that indicates we're not tracking original precompilation flags
            if (xData.flags != null) {
                // Flags are only added for non-internal regexes by `XRegExp.globalize`. Flags are
                // never removed for non-internal regexes, so don't need to handle it
                xregexpFlags = flagsToAdd ? clipDuplicates(xData.flags + flagsToAdd) : xData.flags;
            }
        }

        // Augment with `XRegExp.prototype` properties, but use the native `RegExp` constructor to
        // avoid searching for special tokens. That would be wrong for regexes constructed by
        // `RegExp`, and unnecessary for regexes constructed by `XRegExp` because the regex has
        // already undergone the translation to native regex syntax
        regex = augment(
            new RegExp(regex.source, flags),
            hasNamedCapture(regex) ? xData.captureNames.slice(0) : null,
            xregexpSource,
            xregexpFlags,
            options.isInternalOnly
        );

        return regex;
    }

/**
 * Converts hexadecimal to decimal.
 *
 * @private
 * @param {String} hex
 * @returns {Number}
 */
    function dec(hex) {
        return parseInt(hex, 16);
    }

/**
 * Returns native `RegExp` flags used by a regex object.
 *
 * @private
 * @param {RegExp} regex Regex to check.
 * @returns {String} Native flags in use.
 */
    function getNativeFlags(regex) {
        return hasFlagsProp ?
            regex.flags :
            // Explicitly using `RegExp.prototype.toString` (rather than e.g. `String` or
            // concatenation with an empty string) allows this to continue working predictably when
            // `XRegExp.proptotype.toString` is overriden
            nativ.exec.call(/\/([a-z]*)$/i, RegExp.prototype.toString.call(regex))[1];
    }

/**
 * Determines whether a regex has extended instance data used to track capture names.
 *
 * @private
 * @param {RegExp} regex Regex to check.
 * @returns {Boolean} Whether the regex uses named capture.
 */
    function hasNamedCapture(regex) {
        return !!(regex[REGEX_DATA] && regex[REGEX_DATA].captureNames);
    }

/**
 * Converts decimal to hexadecimal.
 *
 * @private
 * @param {Number|String} dec
 * @returns {String}
 */
    function hex(dec) {
        return parseInt(dec, 10).toString(16);
    }

/**
 * Returns the first index at which a given value can be found in an array.
 *
 * @private
 * @param {Array} array Array to search.
 * @param {*} value Value to locate in the array.
 * @returns {Number} Zero-based index at which the item is found, or -1.
 */
    function indexOf(array, value) {
        var len = array.length, i;

        for (i = 0; i < len; ++i) {
            if (array[i] === value) {
                return i;
            }
        }

        return -1;
    }

/**
 * Determines whether a value is of the specified type, by resolving its internal [[Class]].
 *
 * @private
 * @param {*} value Object to check.
 * @param {String} type Type to check for, in TitleCase.
 * @returns {Boolean} Whether the object matches the type.
 */
    function isType(value, type) {
        return toString.call(value) === '[object ' + type + ']';
    }

/**
 * Checks whether the next nonignorable token after the specified position is a quantifier.
 *
 * @private
 * @param {String} pattern Pattern to search within.
 * @param {Number} pos Index in `pattern` to search at.
 * @param {String} flags Flags used by the pattern.
 * @returns {Boolean} Whether the next token is a quantifier.
 */
    function isQuantifierNext(pattern, pos, flags) {
        return nativ.test.call(
            flags.indexOf('x') > -1 ?
                // Ignore any leading whitespace, line comments, and inline comments
                /^(?:\s+|#.*|\(\?#[^)]*\))*(?:[?*+]|{\d+(?:,\d*)?})/ :
                // Ignore any leading inline comments
                /^(?:\(\?#[^)]*\))*(?:[?*+]|{\d+(?:,\d*)?})/,
            pattern.slice(pos)
        );
    }

/**
 * Pads the provided string with as many leading zeros as needed to get to length 4. Used to produce
 * fixed-length hexadecimal values.
 *
 * @private
 * @param {String} str
 * @returns {String}
 */
    function pad4(str) {
        while (str.length < 4) {
            str = '0' + str;
        }
        return str;
    }

/**
 * Checks for flag-related errors, and strips/applies flags in a leading mode modifier. Offloads
 * the flag preparation logic from the `XRegExp` constructor.
 *
 * @private
 * @param {String} pattern Regex pattern, possibly with a leading mode modifier.
 * @param {String} flags Any combination of flags.
 * @returns {Object} Object with properties `pattern` and `flags`.
 */
    function prepareFlags(pattern, flags) {
        var i;

        // Recent browsers throw on duplicate flags, so copy this behavior for nonnative flags
        if (clipDuplicates(flags) !== flags) {
            throw new SyntaxError('Invalid duplicate regex flag ' + flags);
        }

        // Strip and apply a leading mode modifier with any combination of flags except g or y
        pattern = nativ.replace.call(pattern, /^\(\?([\w$]+)\)/, function($0, $1) {
            if (nativ.test.call(/[gy]/, $1)) {
                throw new SyntaxError('Cannot use flag g or y in mode modifier ' + $0);
            }
            // Allow duplicate flags within the mode modifier
            flags = clipDuplicates(flags + $1);
            return '';
        });

        // Throw on unknown native or nonnative flags
        for (i = 0; i < flags.length; ++i) {
            if (!registeredFlags[flags.charAt(i)]) {
                throw new SyntaxError('Unknown regex flag ' + flags.charAt(i));
            }
        }

        return {
            pattern: pattern,
            flags: flags
        };
    }

/**
 * Prepares an options object from the given value.
 *
 * @private
 * @param {String|Object} value Value to convert to an options object.
 * @returns {Object} Options object.
 */
    function prepareOptions(value) {
        var options = {};

        if (isType(value, 'String')) {
            XRegExp.forEach(value, /[^\s,]+/, function(match) {
                options[match] = true;
            });

            return options;
        }

        return value;
    }

/**
 * Registers a flag so it doesn't throw an 'unknown flag' error.
 *
 * @private
 * @param {String} flag Single-character flag to register.
 */
    function registerFlag(flag) {
        if (!/^[\w$]$/.test(flag)) {
            throw new Error('Flag must be a single character A-Za-z0-9_$');
        }

        registeredFlags[flag] = true;
    }

/**
 * Runs built-in and custom regex syntax tokens in reverse insertion order at the specified
 * position, until a match is found.
 *
 * @private
 * @param {String} pattern Original pattern from which an XRegExp object is being built.
 * @param {String} flags Flags being used to construct the regex.
 * @param {Number} pos Position to search for tokens within `pattern`.
 * @param {Number} scope Regex scope to apply: 'default' or 'class'.
 * @param {Object} context Context object to use for token handler functions.
 * @returns {Object} Object with properties `matchLength`, `output`, and `reparse`; or `null`.
 */
    function runTokens(pattern, flags, pos, scope, context) {
        var i = tokens.length,
            leadChar = pattern.charAt(pos),
            result = null,
            match,
            t;

        // Run in reverse insertion order
        while (i--) {
            t = tokens[i];
            if (
                (t.leadChar && t.leadChar !== leadChar) ||
                (t.scope !== scope && t.scope !== 'all') ||
                (t.flag && flags.indexOf(t.flag) === -1)
            ) {
                continue;
            }

            match = XRegExp.exec(pattern, t.regex, pos, 'sticky');
            if (match) {
                result = {
                    matchLength: match[0].length,
                    output: t.handler.call(context, match, scope, flags),
                    reparse: t.reparse
                };
                // Finished with token tests
                break;
            }
        }

        return result;
    }

/**
 * Enables or disables implicit astral mode opt-in. When enabled, flag A is automatically added to
 * all new regexes created by XRegExp. This causes an error to be thrown when creating regexes if
 * the Unicode Base addon is not available, since flag A is registered by that addon.
 *
 * @private
 * @param {Boolean} on `true` to enable; `false` to disable.
 */
    function setAstral(on) {
        features.astral = on;
    }

/**
 * Enables or disables native method overrides.
 *
 * @private
 * @param {Boolean} on `true` to enable; `false` to disable.
 */
    function setNatives(on) {
        RegExp.prototype.exec = (on ? fixed : nativ).exec;
        RegExp.prototype.test = (on ? fixed : nativ).test;
        String.prototype.match = (on ? fixed : nativ).match;
        String.prototype.replace = (on ? fixed : nativ).replace;
        String.prototype.split = (on ? fixed : nativ).split;

        features.natives = on;
    }

/**
 * Returns the object, or throws an error if it is `null` or `undefined`. This is used to follow
 * the ES5 abstract operation `ToObject`.
 *
 * @private
 * @param {*} value Object to check and return.
 * @returns {*} The provided object.
 */
    function toObject(value) {
        // null or undefined
        if (value == null) {
            throw new TypeError('Cannot convert null or undefined to object');
        }

        return value;
    }

/* ==============================
 * Constructor
 * ============================== */

/**
 * Creates an extended regular expression object for matching text with a pattern. Differs from a
 * native regular expression in that additional syntax and flags are supported. The returned object
 * is in fact a native `RegExp` and works with all native methods.
 *
 * @class XRegExp
 * @constructor
 * @param {String|RegExp} pattern Regex pattern string, or an existing regex object to copy.
 * @param {String} [flags] Any combination of flags.
 *   Native flags:
 *     <li>`g` - global
 *     <li>`i` - ignore case
 *     <li>`m` - multiline anchors
 *     <li>`u` - unicode (ES6)
 *     <li>`y` - sticky (Firefox 3+, ES6)
 *   Additional XRegExp flags:
 *     <li>`n` - explicit capture
 *     <li>`s` - dot matches all (aka singleline)
 *     <li>`x` - free-spacing and line comments (aka extended)
 *     <li>`A` - astral (requires the Unicode Base addon)
 *   Flags cannot be provided when constructing one `RegExp` from another.
 * @returns {RegExp} Extended regular expression object.
 * @example
 *
 * // With named capture and flag x
 * XRegExp('(?<year>  [0-9]{4} ) -?  # year  \n\
 *          (?<month> [0-9]{2} ) -?  # month \n\
 *          (?<day>   [0-9]{2} )     # day   ', 'x');
 *
 * // Providing a regex object copies it. Native regexes are recompiled using native (not XRegExp)
 * // syntax. Copies maintain extended data, are augmented with `XRegExp.prototype` properties, and
 * // have fresh `lastIndex` properties (set to zero).
 * XRegExp(/regex/);
 */
    function XRegExp(pattern, flags) {
        var context = {
                hasNamedCapture: false,
                captureNames: []
            },
            scope = defaultScope,
            output = '',
            pos = 0,
            result,
            token,
            generated,
            appliedPattern,
            appliedFlags;

        if (XRegExp.isRegExp(pattern)) {
            if (flags !== undefined) {
                throw new TypeError('Cannot supply flags when copying a RegExp');
            }
            return copyRegex(pattern);
        }

        // Copy the argument behavior of `RegExp`
        pattern = pattern === undefined ? '' : String(pattern);
        flags = flags === undefined ? '' : String(flags);

        if (XRegExp.isInstalled('astral') && flags.indexOf('A') === -1) {
            // This causes an error to be thrown if the Unicode Base addon is not available
            flags += 'A';
        }

        if (!patternCache[pattern]) {
            patternCache[pattern] = {};
        }

        if (!patternCache[pattern][flags]) {
            // Check for flag-related errors, and strip/apply flags in a leading mode modifier
            result = prepareFlags(pattern, flags);
            appliedPattern = result.pattern;
            appliedFlags = result.flags;

            // Use XRegExp's tokens to translate the pattern to a native regex pattern.
            // `appliedPattern.length` may change on each iteration if tokens use `reparse`
            while (pos < appliedPattern.length) {
                do {
                    // Check for custom tokens at the current position
                    result = runTokens(appliedPattern, appliedFlags, pos, scope, context);
                    // If the matched token used the `reparse` option, splice its output into the
                    // pattern before running tokens again at the same position
                    if (result && result.reparse) {
                        appliedPattern = appliedPattern.slice(0, pos) +
                            result.output +
                            appliedPattern.slice(pos + result.matchLength);
                    }
                } while (result && result.reparse);

                if (result) {
                    output += result.output;
                    pos += (result.matchLength || 1);
                } else {
                    // Get the native token at the current position
                    token = XRegExp.exec(appliedPattern, nativeTokens[scope], pos, 'sticky')[0];
                    output += token;
                    pos += token.length;
                    if (token === '[' && scope === defaultScope) {
                        scope = classScope;
                    } else if (token === ']' && scope === classScope) {
                        scope = defaultScope;
                    }
                }
            }

            patternCache[pattern][flags] = {
                pattern: output,
                // Strip all but native flags
                flags: nativ.replace.call(appliedFlags, /[^gimuy]+/g, ''),
                // `context.captureNames` has an item for each capturing group, even if unnamed
                captures: context.hasNamedCapture ? context.captureNames : null
            };
        }

        generated = patternCache[pattern][flags];
        return augment(
            new RegExp(generated.pattern, generated.flags),
            generated.captures,
            pattern,
            flags
        );
    };

// Add `RegExp.prototype` to the prototype chain
    XRegExp.prototype = new RegExp();

/* ==============================
 * Public properties
 * ============================== */

/**
 * The XRegExp version number as a string containing three dot-separated parts. For example,
 * '2.0.0-beta-3'.
 *
 * @static
 * @memberOf XRegExp
 * @type String
 */
    XRegExp.version = '3.1.0';

/* ==============================
 * Public methods
 * ============================== */

// Intentionally undocumented
    XRegExp._hasNativeFlag = hasNativeFlag;

/**
 * Extends XRegExp syntax and allows custom flags. This is used internally and can be used to
 * create XRegExp addons. If more than one token can match the same string, the last added wins.
 *
 * @memberOf XRegExp
 * @param {RegExp} regex Regex object that matches the new token.
 * @param {Function} handler Function that returns a new pattern string (using native regex syntax)
 *   to replace the matched token within all future XRegExp regexes. Has access to persistent
 *   properties of the regex being built, through `this`. Invoked with three arguments:
 *   <li>The match array, with named backreference properties.
 *   <li>The regex scope where the match was found: 'default' or 'class'.
 *   <li>The flags used by the regex, including any flags in a leading mode modifier.
 *   The handler function becomes part of the XRegExp construction process, so be careful not to
 *   construct XRegExps within the function or you will trigger infinite recursion.
 * @param {Object} [options] Options object with optional properties:
 *   <li>`scope` {String} Scope where the token applies: 'default', 'class', or 'all'.
 *   <li>`flag` {String} Single-character flag that triggers the token. This also registers the
 *     flag, which prevents XRegExp from throwing an 'unknown flag' error when the flag is used.
 *   <li>`optionalFlags` {String} Any custom flags checked for within the token `handler` that are
 *     not required to trigger the token. This registers the flags, to prevent XRegExp from
 *     throwing an 'unknown flag' error when any of the flags are used.
 *   <li>`reparse` {Boolean} Whether the `handler` function's output should not be treated as
 *     final, and instead be reparseable by other tokens (including the current token). Allows
 *     token chaining or deferring.
 *   <li>`leadChar` {String} Single character that occurs at the beginning of any successful match
 *     of the token (not always applicable). This doesn't change the behavior of the token unless
 *     you provide an erroneous value. However, providing it can increase the token's performance
 *     since the token can be skipped at any positions where this character doesn't appear.
 * @example
 *
 * // Basic usage: Add \a for the ALERT control code
 * XRegExp.addToken(
 *   /\\a/,
 *   function() {return '\\x07';},
 *   {scope: 'all'}
 * );
 * XRegExp('\\a[\\a-\\n]+').test('\x07\n\x07'); // -> true
 *
 * // Add the U (ungreedy) flag from PCRE and RE2, which reverses greedy and lazy quantifiers.
 * // Since `scope` is not specified, it uses 'default' (i.e., transformations apply outside of
 * // character classes only)
 * XRegExp.addToken(
 *   /([?*+]|{\d+(?:,\d*)?})(\??)/,
 *   function(match) {return match[1] + (match[2] ? '' : '?');},
 *   {flag: 'U'}
 * );
 * XRegExp('a+', 'U').exec('aaa')[0]; // -> 'a'
 * XRegExp('a+?', 'U').exec('aaa')[0]; // -> 'aaa'
 */
    XRegExp.addToken = function(regex, handler, options) {
        options = options || {};
        var optionalFlags = options.optionalFlags, i;

        if (options.flag) {
            registerFlag(options.flag);
        }

        if (optionalFlags) {
            optionalFlags = nativ.split.call(optionalFlags, '');
            for (i = 0; i < optionalFlags.length; ++i) {
                registerFlag(optionalFlags[i]);
            }
        }

        // Add to the private list of syntax tokens
        tokens.push({
            regex: copyRegex(regex, {
                addG: true,
                addY: hasNativeY,
                isInternalOnly: true
            }),
            handler: handler,
            scope: options.scope || defaultScope,
            flag: options.flag,
            reparse: options.reparse,
            leadChar: options.leadChar
        });

        // Reset the pattern cache used by the `XRegExp` constructor, since the same pattern and
        // flags might now produce different results
        XRegExp.cache.flush('patterns');
    };

/**
 * Caches and returns the result of calling `XRegExp(pattern, flags)`. On any subsequent call with
 * the same pattern and flag combination, the cached copy of the regex is returned.
 *
 * @memberOf XRegExp
 * @param {String} pattern Regex pattern string.
 * @param {String} [flags] Any combination of XRegExp flags.
 * @returns {RegExp} Cached XRegExp object.
 * @example
 *
 * while (match = XRegExp.cache('.', 'gs').exec(str)) {
 *   // The regex is compiled once only
 * }
 */
    XRegExp.cache = function(pattern, flags) {
        if (!regexCache[pattern]) {
            regexCache[pattern] = {};
        }
        return regexCache[pattern][flags] || (
            regexCache[pattern][flags] = XRegExp(pattern, flags)
        );
    };

// Intentionally undocumented
    XRegExp.cache.flush = function(cacheName) {
        if (cacheName === 'patterns') {
            // Flush the pattern cache used by the `XRegExp` constructor
            patternCache = {};
        } else {
            // Flush the regex cache populated by `XRegExp.cache`
            regexCache = {};
        }
    };

/**
 * Escapes any regular expression metacharacters, for use when matching literal strings. The result
 * can safely be used at any point within a regex that uses any flags.
 *
 * @memberOf XRegExp
 * @param {String} str String to escape.
 * @returns {String} String with regex metacharacters escaped.
 * @example
 *
 * XRegExp.escape('Escaped? <.>');
 * // -> 'Escaped\?\ <\.>'
 */
    XRegExp.escape = function(str) {
        return nativ.replace.call(toObject(str), /[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    };

/**
 * Executes a regex search in a specified string. Returns a match array or `null`. If the provided
 * regex uses named capture, named backreference properties are included on the match array.
 * Optional `pos` and `sticky` arguments specify the search start position, and whether the match
 * must start at the specified position only. The `lastIndex` property of the provided regex is not
 * used, but is updated for compatibility. Also fixes browser bugs compared to the native
 * `RegExp.prototype.exec` and can be used reliably cross-browser.
 *
 * @memberOf XRegExp
 * @param {String} str String to search.
 * @param {RegExp} regex Regex to search with.
 * @param {Number} [pos=0] Zero-based index at which to start the search.
 * @param {Boolean|String} [sticky=false] Whether the match must start at the specified position
 *   only. The string `'sticky'` is accepted as an alternative to `true`.
 * @returns {Array} Match array with named backreference properties, or `null`.
 * @example
 *
 * // Basic use, with named backreference
 * var match = XRegExp.exec('U+2620', XRegExp('U\\+(?<hex>[0-9A-F]{4})'));
 * match.hex; // -> '2620'
 *
 * // With pos and sticky, in a loop
 * var pos = 2, result = [], match;
 * while (match = XRegExp.exec('<1><2><3><4>5<6>', /<(\d)>/, pos, 'sticky')) {
 *   result.push(match[1]);
 *   pos = match.index + match[0].length;
 * }
 * // result -> ['2', '3', '4']
 */
    XRegExp.exec = function(str, regex, pos, sticky) {
        var cacheKey = 'g',
            addY = false,
            match,
            r2;

        addY = hasNativeY && !!(sticky || (regex.sticky && sticky !== false));
        if (addY) {
            cacheKey += 'y';
        }

        regex[REGEX_DATA] = regex[REGEX_DATA] || {};

        // Shares cached copies with `XRegExp.match`/`replace`
        r2 = regex[REGEX_DATA][cacheKey] || (
            regex[REGEX_DATA][cacheKey] = copyRegex(regex, {
                addG: true,
                addY: addY,
                removeY: sticky === false,
                isInternalOnly: true
            })
        );

        r2.lastIndex = pos = pos || 0;

        // Fixed `exec` required for `lastIndex` fix, named backreferences, etc.
        match = fixed.exec.call(r2, str);

        if (sticky && match && match.index !== pos) {
            match = null;
        }

        if (regex.global) {
            regex.lastIndex = match ? r2.lastIndex : 0;
        }

        return match;
    };

/**
 * Executes a provided function once per regex match. Searches always start at the beginning of the
 * string and continue until the end, regardless of the state of the regex's `global` property and
 * initial `lastIndex`.
 *
 * @memberOf XRegExp
 * @param {String} str String to search.
 * @param {RegExp} regex Regex to search with.
 * @param {Function} callback Function to execute for each match. Invoked with four arguments:
 *   <li>The match array, with named backreference properties.
 *   <li>The zero-based match index.
 *   <li>The string being traversed.
 *   <li>The regex object being used to traverse the string.
 * @example
 *
 * // Extracts every other digit from a string
 * var evens = [];
 * XRegExp.forEach('1a2345', /\d/, function(match, i) {
 *   if (i % 2) evens.push(+match[0]);
 * });
 * // evens -> [2, 4]
 */
    XRegExp.forEach = function(str, regex, callback) {
        var pos = 0,
            i = -1,
            match;

        while ((match = XRegExp.exec(str, regex, pos))) {
            // Because `regex` is provided to `callback`, the function could use the deprecated/
            // nonstandard `RegExp.prototype.compile` to mutate the regex. However, since
            // `XRegExp.exec` doesn't use `lastIndex` to set the search position, this can't lead
            // to an infinite loop, at least. Actually, because of the way `XRegExp.exec` caches
            // globalized versions of regexes, mutating the regex will not have any effect on the
            // iteration or matched strings, which is a nice side effect that brings extra safety
            callback(match, ++i, str, regex);

            pos = match.index + (match[0].length || 1);
        }
    };

/**
 * Copies a regex object and adds flag `g`. The copy maintains extended data, is augmented with
 * `XRegExp.prototype` properties, and has a fresh `lastIndex` property (set to zero). Native
 * regexes are not recompiled using XRegExp syntax.
 *
 * @memberOf XRegExp
 * @param {RegExp} regex Regex to globalize.
 * @returns {RegExp} Copy of the provided regex with flag `g` added.
 * @example
 *
 * var globalCopy = XRegExp.globalize(/regex/);
 * globalCopy.global; // -> true
 */
    XRegExp.globalize = function(regex) {
        return copyRegex(regex, {addG: true});
    };

/**
 * Installs optional features according to the specified options. Can be undone using
 * `XRegExp.uninstall`.
 *
 * @memberOf XRegExp
 * @param {Object|String} options Options object or string.
 * @example
 *
 * // With an options object
 * XRegExp.install({
 *   // Enables support for astral code points in Unicode addons (implicitly sets flag A)
 *   astral: true,
 *
 *   // DEPRECATED: Overrides native regex methods with fixed/extended versions
 *   natives: true
 * });
 *
 * // With an options string
 * XRegExp.install('astral natives');
 */
    XRegExp.install = function(options) {
        options = prepareOptions(options);

        if (!features.astral && options.astral) {
            setAstral(true);
        }

        if (!features.natives && options.natives) {
            setNatives(true);
        }
    };

/**
 * Checks whether an individual optional feature is installed.
 *
 * @memberOf XRegExp
 * @param {String} feature Name of the feature to check. One of:
 *   <li>`astral`
 *   <li>`natives`
 * @returns {Boolean} Whether the feature is installed.
 * @example
 *
 * XRegExp.isInstalled('astral');
 */
    XRegExp.isInstalled = function(feature) {
        return !!(features[feature]);
    };

/**
 * Returns `true` if an object is a regex; `false` if it isn't. This works correctly for regexes
 * created in another frame, when `instanceof` and `constructor` checks would fail.
 *
 * @memberOf XRegExp
 * @param {*} value Object to check.
 * @returns {Boolean} Whether the object is a `RegExp` object.
 * @example
 *
 * XRegExp.isRegExp('string'); // -> false
 * XRegExp.isRegExp(/regex/i); // -> true
 * XRegExp.isRegExp(RegExp('^', 'm')); // -> true
 * XRegExp.isRegExp(XRegExp('(?s).')); // -> true
 */
    XRegExp.isRegExp = function(value) {
        return toString.call(value) === '[object RegExp]';
        //return isType(value, 'RegExp');
    };

/**
 * Returns the first matched string, or in global mode, an array containing all matched strings.
 * This is essentially a more convenient re-implementation of `String.prototype.match` that gives
 * the result types you actually want (string instead of `exec`-style array in match-first mode,
 * and an empty array instead of `null` when no matches are found in match-all mode). It also lets
 * you override flag g and ignore `lastIndex`, and fixes browser bugs.
 *
 * @memberOf XRegExp
 * @param {String} str String to search.
 * @param {RegExp} regex Regex to search with.
 * @param {String} [scope='one'] Use 'one' to return the first match as a string. Use 'all' to
 *   return an array of all matched strings. If not explicitly specified and `regex` uses flag g,
 *   `scope` is 'all'.
 * @returns {String|Array} In match-first mode: First match as a string, or `null`. In match-all
 *   mode: Array of all matched strings, or an empty array.
 * @example
 *
 * // Match first
 * XRegExp.match('abc', /\w/); // -> 'a'
 * XRegExp.match('abc', /\w/g, 'one'); // -> 'a'
 * XRegExp.match('abc', /x/g, 'one'); // -> null
 *
 * // Match all
 * XRegExp.match('abc', /\w/g); // -> ['a', 'b', 'c']
 * XRegExp.match('abc', /\w/, 'all'); // -> ['a', 'b', 'c']
 * XRegExp.match('abc', /x/, 'all'); // -> []
 */
    XRegExp.match = function(str, regex, scope) {
        var global = (regex.global && scope !== 'one') || scope === 'all',
            cacheKey = ((global ? 'g' : '') + (regex.sticky ? 'y' : '')) || 'noGY',
            result,
            r2;

        regex[REGEX_DATA] = regex[REGEX_DATA] || {};

        // Shares cached copies with `XRegExp.exec`/`replace`
        r2 = regex[REGEX_DATA][cacheKey] || (
            regex[REGEX_DATA][cacheKey] = copyRegex(regex, {
                addG: !!global,
                removeG: scope === 'one',
                isInternalOnly: true
            })
        );

        result = nativ.match.call(toObject(str), r2);

        if (regex.global) {
            regex.lastIndex = (
                (scope === 'one' && result) ?
                    // Can't use `r2.lastIndex` since `r2` is nonglobal in this case
                    (result.index + result[0].length) : 0
            );
        }

        return global ? (result || []) : (result && result[0]);
    };

/**
 * Retrieves the matches from searching a string using a chain of regexes that successively search
 * within previous matches. The provided `chain` array can contain regexes and or objects with
 * `regex` and `backref` properties. When a backreference is specified, the named or numbered
 * backreference is passed forward to the next regex or returned.
 *
 * @memberOf XRegExp
 * @param {String} str String to search.
 * @param {Array} chain Regexes that each search for matches within preceding results.
 * @returns {Array} Matches by the last regex in the chain, or an empty array.
 * @example
 *
 * // Basic usage; matches numbers within <b> tags
 * XRegExp.matchChain('1 <b>2</b> 3 <b>4 a 56</b>', [
 *   XRegExp('(?is)<b>.*?</b>'),
 *   /\d+/
 * ]);
 * // -> ['2', '4', '56']
 *
 * // Passing forward and returning specific backreferences
 * html = '<a href="http://xregexp.com/api/">XRegExp</a>\
 *         <a href="http://www.google.com/">Google</a>';
 * XRegExp.matchChain(html, [
 *   {regex: /<a href="([^"]+)">/i, backref: 1},
 *   {regex: XRegExp('(?i)^https?://(?<domain>[^/?#]+)'), backref: 'domain'}
 * ]);
 * // -> ['xregexp.com', 'www.google.com']
 */
    XRegExp.matchChain = function(str, chain) {
        return (function recurseChain(values, level) {
            var item = chain[level].regex ? chain[level] : {regex: chain[level]},
                matches = [],
                addMatch = function(match) {
                    if (item.backref) {
                        /* Safari 4.0.5 (but not 5.0.5+) inappropriately uses sparse arrays to hold
                         * the `undefined`s for backreferences to nonparticipating capturing
                         * groups. In such cases, a `hasOwnProperty` or `in` check on its own would
                         * inappropriately throw the exception, so also check if the backreference
                         * is a number that is within the bounds of the array.
                         */
                        if (!(match.hasOwnProperty(item.backref) || +item.backref < match.length)) {
                            throw new ReferenceError('Backreference to undefined group: ' + item.backref);
                        }

                        matches.push(match[item.backref] || '');
                    } else {
                        matches.push(match[0]);
                    }
                },
                i;

            for (i = 0; i < values.length; ++i) {
                XRegExp.forEach(values[i], item.regex, addMatch);
            }

            return ((level === chain.length - 1) || !matches.length) ?
                matches :
                recurseChain(matches, level + 1);
        }([str], 0));
    };

/**
 * Returns a new string with one or all matches of a pattern replaced. The pattern can be a string
 * or regex, and the replacement can be a string or a function to be called for each match. To
 * perform a global search and replace, use the optional `scope` argument or include flag g if using
 * a regex. Replacement strings can use `${n}` for named and numbered backreferences. Replacement
 * functions can use named backreferences via `arguments[0].name`. Also fixes browser bugs compared
 * to the native `String.prototype.replace` and can be used reliably cross-browser.
 *
 * @memberOf XRegExp
 * @param {String} str String to search.
 * @param {RegExp|String} search Search pattern to be replaced.
 * @param {String|Function} replacement Replacement string or a function invoked to create it.
 *   Replacement strings can include special replacement syntax:
 *     <li>$$ - Inserts a literal $ character.
 *     <li>$&, $0 - Inserts the matched substring.
 *     <li>$` - Inserts the string that precedes the matched substring (left context).
 *     <li>$' - Inserts the string that follows the matched substring (right context).
 *     <li>$n, $nn - Where n/nn are digits referencing an existent capturing group, inserts
 *       backreference n/nn.
 *     <li>${n} - Where n is a name or any number of digits that reference an existent capturing
 *       group, inserts backreference n.
 *   Replacement functions are invoked with three or more arguments:
 *     <li>The matched substring (corresponds to $& above). Named backreferences are accessible as
 *       properties of this first argument.
 *     <li>0..n arguments, one for each backreference (corresponding to $1, $2, etc. above).
 *     <li>The zero-based index of the match within the total search string.
 *     <li>The total string being searched.
 * @param {String} [scope='one'] Use 'one' to replace the first match only, or 'all'. If not
 *   explicitly specified and using a regex with flag g, `scope` is 'all'.
 * @returns {String} New string with one or all matches replaced.
 * @example
 *
 * // Regex search, using named backreferences in replacement string
 * var name = XRegExp('(?<first>\\w+) (?<last>\\w+)');
 * XRegExp.replace('John Smith', name, '${last}, ${first}');
 * // -> 'Smith, John'
 *
 * // Regex search, using named backreferences in replacement function
 * XRegExp.replace('John Smith', name, function(match) {
 *   return match.last + ', ' + match.first;
 * });
 * // -> 'Smith, John'
 *
 * // String search, with replace-all
 * XRegExp.replace('RegExp builds RegExps', 'RegExp', 'XRegExp', 'all');
 * // -> 'XRegExp builds XRegExps'
 */
    XRegExp.replace = function(str, search, replacement, scope) {
        var isRegex = XRegExp.isRegExp(search),
            global = (search.global && scope !== 'one') || scope === 'all',
            cacheKey = ((global ? 'g' : '') + (search.sticky ? 'y' : '')) || 'noGY',
            s2 = search,
            result;

        if (isRegex) {
            search[REGEX_DATA] = search[REGEX_DATA] || {};

            // Shares cached copies with `XRegExp.exec`/`match`. Since a copy is used, `search`'s
            // `lastIndex` isn't updated *during* replacement iterations
            s2 = search[REGEX_DATA][cacheKey] || (
                search[REGEX_DATA][cacheKey] = copyRegex(search, {
                    addG: !!global,
                    removeG: scope === 'one',
                    isInternalOnly: true
                })
            );
        } else if (global) {
            s2 = new RegExp(XRegExp.escape(String(search)), 'g');
        }

        // Fixed `replace` required for named backreferences, etc.
        result = fixed.replace.call(toObject(str), s2, replacement);

        if (isRegex && search.global) {
            // Fixes IE, Safari bug (last tested IE 9, Safari 5.1)
            search.lastIndex = 0;
        }

        return result;
    };

/**
 * Performs batch processing of string replacements. Used like `XRegExp.replace`, but accepts an
 * array of replacement details. Later replacements operate on the output of earlier replacements.
 * Replacement details are accepted as an array with a regex or string to search for, the
 * replacement string or function, and an optional scope of 'one' or 'all'. Uses the XRegExp
 * replacement text syntax, which supports named backreference properties via `${name}`.
 *
 * @memberOf XRegExp
 * @param {String} str String to search.
 * @param {Array} replacements Array of replacement detail arrays.
 * @returns {String} New string with all replacements.
 * @example
 *
 * str = XRegExp.replaceEach(str, [
 *   [XRegExp('(?<name>a)'), 'z${name}'],
 *   [/b/gi, 'y'],
 *   [/c/g, 'x', 'one'], // scope 'one' overrides /g
 *   [/d/, 'w', 'all'],  // scope 'all' overrides lack of /g
 *   ['e', 'v', 'all'],  // scope 'all' allows replace-all for strings
 *   [/f/g, function($0) {
 *     return $0.toUpperCase();
 *   }]
 * ]);
 */
    XRegExp.replaceEach = function(str, replacements) {
        var i, r;

        for (i = 0; i < replacements.length; ++i) {
            r = replacements[i];
            str = XRegExp.replace(str, r[0], r[1], r[2]);
        }

        return str;
    };

/**
 * Splits a string into an array of strings using a regex or string separator. Matches of the
 * separator are not included in the result array. However, if `separator` is a regex that contains
 * capturing groups, backreferences are spliced into the result each time `separator` is matched.
 * Fixes browser bugs compared to the native `String.prototype.split` and can be used reliably
 * cross-browser.
 *
 * @memberOf XRegExp
 * @param {String} str String to split.
 * @param {RegExp|String} separator Regex or string to use for separating the string.
 * @param {Number} [limit] Maximum number of items to include in the result array.
 * @returns {Array} Array of substrings.
 * @example
 *
 * // Basic use
 * XRegExp.split('a b c', ' ');
 * // -> ['a', 'b', 'c']
 *
 * // With limit
 * XRegExp.split('a b c', ' ', 2);
 * // -> ['a', 'b']
 *
 * // Backreferences in result array
 * XRegExp.split('..word1..', /([a-z]+)(\d+)/i);
 * // -> ['..', 'word', '1', '..']
 */
    XRegExp.split = function(str, separator, limit) {
        return fixed.split.call(toObject(str), separator, limit);
    };

/**
 * Executes a regex search in a specified string. Returns `true` or `false`. Optional `pos` and
 * `sticky` arguments specify the search start position, and whether the match must start at the
 * specified position only. The `lastIndex` property of the provided regex is not used, but is
 * updated for compatibility. Also fixes browser bugs compared to the native
 * `RegExp.prototype.test` and can be used reliably cross-browser.
 *
 * @memberOf XRegExp
 * @param {String} str String to search.
 * @param {RegExp} regex Regex to search with.
 * @param {Number} [pos=0] Zero-based index at which to start the search.
 * @param {Boolean|String} [sticky=false] Whether the match must start at the specified position
 *   only. The string `'sticky'` is accepted as an alternative to `true`.
 * @returns {Boolean} Whether the regex matched the provided value.
 * @example
 *
 * // Basic use
 * XRegExp.test('abc', /c/); // -> true
 *
 * // With pos and sticky
 * XRegExp.test('abc', /c/, 0, 'sticky'); // -> false
 * XRegExp.test('abc', /c/, 2, 'sticky'); // -> true
 */
    XRegExp.test = function(str, regex, pos, sticky) {
        // Do this the easy way :-)
        return !!XRegExp.exec(str, regex, pos, sticky);
    };

/**
 * Uninstalls optional features according to the specified options. All optional features start out
 * uninstalled, so this is used to undo the actions of `XRegExp.install`.
 *
 * @memberOf XRegExp
 * @param {Object|String} options Options object or string.
 * @example
 *
 * // With an options object
 * XRegExp.uninstall({
 *   // Disables support for astral code points in Unicode addons
 *   astral: true,
 *
 *   // DEPRECATED: Restores native regex methods
 *   natives: true
 * });
 *
 * // With an options string
 * XRegExp.uninstall('astral natives');
 */
    XRegExp.uninstall = function(options) {
        options = prepareOptions(options);

        if (features.astral && options.astral) {
            setAstral(false);
        }

        if (features.natives && options.natives) {
            setNatives(false);
        }
    };

/**
 * Returns an XRegExp object that is the union of the given patterns. Patterns can be provided as
 * regex objects or strings. Metacharacters are escaped in patterns provided as strings.
 * Backreferences in provided regex objects are automatically renumbered to work correctly within
 * the larger combined pattern. Native flags used by provided regexes are ignored in favor of the
 * `flags` argument.
 *
 * @memberOf XRegExp
 * @param {Array} patterns Regexes and strings to combine.
 * @param {String} [flags] Any combination of XRegExp flags.
 * @returns {RegExp} Union of the provided regexes and strings.
 * @example
 *
 * XRegExp.union(['a+b*c', /(dogs)\1/, /(cats)\1/], 'i');
 * // -> /a\+b\*c|(dogs)\1|(cats)\2/i
 */
    XRegExp.union = function(patterns, flags) {
        var parts = /(\()(?!\?)|\\([1-9]\d*)|\\[\s\S]|\[(?:[^\\\]]|\\[\s\S])*]/g,
            output = [],
            numCaptures = 0,
            numPriorCaptures,
            captureNames,
            pattern,
            rewrite = function(match, paren, backref) {
                var name = captureNames[numCaptures - numPriorCaptures];

                // Capturing group
                if (paren) {
                    ++numCaptures;
                    // If the current capture has a name, preserve the name
                    if (name) {
                        return '(?<' + name + '>';
                    }
                // Backreference
                } else if (backref) {
                    // Rewrite the backreference
                    return '\\' + (+backref + numPriorCaptures);
                }

                return match;
            },
            i;

        if (!(isType(patterns, 'Array') && patterns.length)) {
            throw new TypeError('Must provide a nonempty array of patterns to merge');
        }

        for (i = 0; i < patterns.length; ++i) {
            pattern = patterns[i];

            if (XRegExp.isRegExp(pattern)) {
                numPriorCaptures = numCaptures;
                captureNames = (pattern[REGEX_DATA] && pattern[REGEX_DATA].captureNames) || [];

                // Rewrite backreferences. Passing to XRegExp dies on octals and ensures patterns
                // are independently valid; helps keep this simple. Named captures are put back
                output.push(nativ.replace.call(XRegExp(pattern.source).source, parts, rewrite));
            } else {
                output.push(XRegExp.escape(pattern));
            }
        }

        return XRegExp(output.join('|'), flags);
    };

/* ==============================
 * Fixed/extended native methods
 * ============================== */

/**
 * Adds named capture support (with backreferences returned as `result.name`), and fixes browser
 * bugs in the native `RegExp.prototype.exec`. Calling `XRegExp.install('natives')` uses this to
 * override the native method. Use via `XRegExp.exec` without overriding natives.
 *
 * @private
 * @param {String} str String to search.
 * @returns {Array} Match array with named backreference properties, or `null`.
 */
    fixed.exec = function(str) {
        var origLastIndex = this.lastIndex,
            match = nativ.exec.apply(this, arguments),
            name,
            r2,
            i;

        if (match) {
            // Fix browsers whose `exec` methods don't return `undefined` for nonparticipating
            // capturing groups. This fixes IE 5.5-8, but not IE 9's quirks mode or emulation of
            // older IEs. IE 9 in standards mode follows the spec
            if (!correctExecNpcg && match.length > 1 && indexOf(match, '') > -1) {
                r2 = copyRegex(this, {
                    removeG: true,
                    isInternalOnly: true
                });
                // Using `str.slice(match.index)` rather than `match[0]` in case lookahead allowed
                // matching due to characters outside the match
                nativ.replace.call(String(str).slice(match.index), r2, function() {
                    var len = arguments.length, i;
                    // Skip index 0 and the last 2
                    for (i = 1; i < len - 2; ++i) {
                        if (arguments[i] === undefined) {
                            match[i] = undefined;
                        }
                    }
                });
            }

            // Attach named capture properties
            if (this[REGEX_DATA] && this[REGEX_DATA].captureNames) {
                // Skip index 0
                for (i = 1; i < match.length; ++i) {
                    name = this[REGEX_DATA].captureNames[i - 1];
                    if (name) {
                        match[name] = match[i];
                    }
                }
            }

            // Fix browsers that increment `lastIndex` after zero-length matches
            if (this.global && !match[0].length && (this.lastIndex > match.index)) {
                this.lastIndex = match.index;
            }
        }

        if (!this.global) {
            // Fixes IE, Opera bug (last tested IE 9, Opera 11.6)
            this.lastIndex = origLastIndex;
        }

        return match;
    };

/**
 * Fixes browser bugs in the native `RegExp.prototype.test`. Calling `XRegExp.install('natives')`
 * uses this to override the native method.
 *
 * @private
 * @param {String} str String to search.
 * @returns {Boolean} Whether the regex matched the provided value.
 */
    fixed.test = function(str) {
        // Do this the easy way :-)
        return !!fixed.exec.call(this, str);
    };

/**
 * Adds named capture support (with backreferences returned as `result.name`), and fixes browser
 * bugs in the native `String.prototype.match`. Calling `XRegExp.install('natives')` uses this to
 * override the native method.
 *
 * @private
 * @param {RegExp|*} regex Regex to search with. If not a regex object, it is passed to `RegExp`.
 * @returns {Array} If `regex` uses flag g, an array of match strings or `null`. Without flag g,
 *   the result of calling `regex.exec(this)`.
 */
    fixed.match = function(regex) {
        var result;

        if (!XRegExp.isRegExp(regex)) {
            // Use the native `RegExp` rather than `XRegExp`
            regex = new RegExp(regex);
        } else if (regex.global) {
            result = nativ.match.apply(this, arguments);
            // Fixes IE bug
            regex.lastIndex = 0;

            return result;
        }

        return fixed.exec.call(regex, toObject(this));
    };

/**
 * Adds support for `${n}` tokens for named and numbered backreferences in replacement text, and
 * provides named backreferences to replacement functions as `arguments[0].name`. Also fixes browser
 * bugs in replacement text syntax when performing a replacement using a nonregex search value, and
 * the value of a replacement regex's `lastIndex` property during replacement iterations and upon
 * completion. Calling `XRegExp.install('natives')` uses this to override the native method. Note
 * that this doesn't support SpiderMonkey's proprietary third (`flags`) argument. Use via
 * `XRegExp.replace` without overriding natives.
 *
 * @private
 * @param {RegExp|String} search Search pattern to be replaced.
 * @param {String|Function} replacement Replacement string or a function invoked to create it.
 * @returns {String} New string with one or all matches replaced.
 */
    fixed.replace = function(search, replacement) {
        var isRegex = XRegExp.isRegExp(search),
            origLastIndex,
            captureNames,
            result;

        if (isRegex) {
            if (search[REGEX_DATA]) {
                captureNames = search[REGEX_DATA].captureNames;
            }
            // Only needed if `search` is nonglobal
            origLastIndex = search.lastIndex;
        } else {
            search += ''; // Type-convert
        }

        // Don't use `typeof`; some older browsers return 'function' for regex objects
        if (isType(replacement, 'Function')) {
            // Stringifying `this` fixes a bug in IE < 9 where the last argument in replacement
            // functions isn't type-converted to a string
            result = nativ.replace.call(String(this), search, function() {
                var args = arguments, i;
                if (captureNames) {
                    // Change the `arguments[0]` string primitive to a `String` object that can
                    // store properties. This really does need to use `String` as a constructor
                    args[0] = new String(args[0]);
                    // Store named backreferences on the first argument
                    for (i = 0; i < captureNames.length; ++i) {
                        if (captureNames[i]) {
                            args[0][captureNames[i]] = args[i + 1];
                        }
                    }
                }
                // Update `lastIndex` before calling `replacement`. Fixes IE, Chrome, Firefox,
                // Safari bug (last tested IE 9, Chrome 17, Firefox 11, Safari 5.1)
                if (isRegex && search.global) {
                    search.lastIndex = args[args.length - 2] + args[0].length;
                }
                // ES6 specs the context for replacement functions as `undefined`
                return replacement.apply(undefined, args);
            });
        } else {
            // Ensure that the last value of `args` will be a string when given nonstring `this`,
            // while still throwing on null or undefined context
            result = nativ.replace.call(this == null ? this : String(this), search, function() {
                // Keep this function's `arguments` available through closure
                var args = arguments;
                return nativ.replace.call(String(replacement), replacementToken, function($0, $1, $2) {
                    var n;
                    // Named or numbered backreference with curly braces
                    if ($1) {
                        // XRegExp behavior for `${n}`:
                        // 1. Backreference to numbered capture, if `n` is an integer. Use `0` for
                        //    for the entire match. Any number of leading zeros may be used.
                        // 2. Backreference to named capture `n`, if it exists and is not an
                        //    integer overridden by numbered capture. In practice, this does not
                        //    overlap with numbered capture since XRegExp does not allow named
                        //    capture to use a bare integer as the name.
                        // 3. If the name or number does not refer to an existing capturing group,
                        //    it's an error.
                        n = +$1; // Type-convert; drop leading zeros
                        if (n <= args.length - 3) {
                            return args[n] || '';
                        }
                        // Groups with the same name is an error, else would need `lastIndexOf`
                        n = captureNames ? indexOf(captureNames, $1) : -1;
                        if (n < 0) {
                            throw new SyntaxError('Backreference to undefined group ' + $0);
                        }
                        return args[n + 1] || '';
                    }
                    // Else, special variable or numbered backreference without curly braces
                    if ($2 === '$') { // $$
                        return '$';
                    }
                    if ($2 === '&' || +$2 === 0) { // $&, $0 (not followed by 1-9), $00
                        return args[0];
                    }
                    if ($2 === '`') { // $` (left context)
                        return args[args.length - 1].slice(0, args[args.length - 2]);
                    }
                    if ($2 === "'") { // $' (right context)
                        return args[args.length - 1].slice(args[args.length - 2] + args[0].length);
                    }
                    // Else, numbered backreference without curly braces
                    $2 = +$2; // Type-convert; drop leading zero
                    // XRegExp behavior for `$n` and `$nn`:
                    // - Backrefs end after 1 or 2 digits. Use `${..}` for more digits.
                    // - `$1` is an error if no capturing groups.
                    // - `$10` is an error if less than 10 capturing groups. Use `${1}0` instead.
                    // - `$01` is `$1` if at least one capturing group, else it's an error.
                    // - `$0` (not followed by 1-9) and `$00` are the entire match.
                    // Native behavior, for comparison:
                    // - Backrefs end after 1 or 2 digits. Cannot reference capturing group 100+.
                    // - `$1` is a literal `$1` if no capturing groups.
                    // - `$10` is `$1` followed by a literal `0` if less than 10 capturing groups.
                    // - `$01` is `$1` if at least one capturing group, else it's a literal `$01`.
                    // - `$0` is a literal `$0`.
                    if (!isNaN($2)) {
                        if ($2 > args.length - 3) {
                            throw new SyntaxError('Backreference to undefined group ' + $0);
                        }
                        return args[$2] || '';
                    }
                    // `$` followed by an unsupported char is an error, unlike native JS
                    throw new SyntaxError('Invalid token ' + $0);
                });
            });
        }

        if (isRegex) {
            if (search.global) {
                // Fixes IE, Safari bug (last tested IE 9, Safari 5.1)
                search.lastIndex = 0;
            } else {
                // Fixes IE, Opera bug (last tested IE 9, Opera 11.6)
                search.lastIndex = origLastIndex;
            }
        }

        return result;
    };

/**
 * Fixes browser bugs in the native `String.prototype.split`. Calling `XRegExp.install('natives')`
 * uses this to override the native method. Use via `XRegExp.split` without overriding natives.
 *
 * @private
 * @param {RegExp|String} separator Regex or string to use for separating the string.
 * @param {Number} [limit] Maximum number of items to include in the result array.
 * @returns {Array} Array of substrings.
 */
    fixed.split = function(separator, limit) {
        if (!XRegExp.isRegExp(separator)) {
            // Browsers handle nonregex split correctly, so use the faster native method
            return nativ.split.apply(this, arguments);
        }

        var str = String(this),
            output = [],
            origLastIndex = separator.lastIndex,
            lastLastIndex = 0,
            lastLength;

        // Values for `limit`, per the spec:
        // If undefined: pow(2,32) - 1
        // If 0, Infinity, or NaN: 0
        // If positive number: limit = floor(limit); if (limit >= pow(2,32)) limit -= pow(2,32);
        // If negative number: pow(2,32) - floor(abs(limit))
        // If other: Type-convert, then use the above rules
        // This line fails in very strange ways for some values of `limit` in Opera 10.5-10.63,
        // unless Opera Dragonfly is open (go figure). It works in at least Opera 9.5-10.1 and 11+
        limit = (limit === undefined ? -1 : limit) >>> 0;

        XRegExp.forEach(str, separator, function(match) {
            // This condition is not the same as `if (match[0].length)`
            if ((match.index + match[0].length) > lastLastIndex) {
                output.push(str.slice(lastLastIndex, match.index));
                if (match.length > 1 && match.index < str.length) {
                    Array.prototype.push.apply(output, match.slice(1));
                }
                lastLength = match[0].length;
                lastLastIndex = match.index + lastLength;
            }
        });

        if (lastLastIndex === str.length) {
            if (!nativ.test.call(separator, '') || lastLength) {
                output.push('');
            }
        } else {
            output.push(str.slice(lastLastIndex));
        }

        separator.lastIndex = origLastIndex;
        return output.length > limit ? output.slice(0, limit) : output;
    };

/* ==============================
 * Built-in syntax/flag tokens
 * ============================== */

/*
 * Letter escapes that natively match literal characters: `\a`, `\A`, etc. These should be
 * SyntaxErrors but are allowed in web reality. XRegExp makes them errors for cross-browser
 * consistency and to reserve their syntax, but lets them be superseded by addons.
 */
    XRegExp.addToken(
        /\\([ABCE-RTUVXYZaeg-mopqyz]|c(?![A-Za-z])|u(?![\dA-Fa-f]{4}|{[\dA-Fa-f]+})|x(?![\dA-Fa-f]{2}))/,
        function(match, scope) {
            // \B is allowed in default scope only
            if (match[1] === 'B' && scope === defaultScope) {
                return match[0];
            }
            throw new SyntaxError('Invalid escape ' + match[0]);
        },
        {
            scope: 'all',
            leadChar: '\\'
        }
    );

/*
 * Unicode code point escape with curly braces: `\u{N..}`. `N..` is any one or more digit
 * hexadecimal number from 0-10FFFF, and can include leading zeros. Requires the native ES6 `u` flag
 * to support code points greater than U+FFFF. Avoids converting code points above U+FFFF to
 * surrogate pairs (which could be done without flag `u`), since that could lead to broken behavior
 * if you follow a `\u{N..}` token that references a code point above U+FFFF with a quantifier, or
 * if you use the same in a character class.
 */
    XRegExp.addToken(
        /\\u{([\dA-Fa-f]+)}/,
        function(match, scope, flags) {
            var code = dec(match[1]);
            if (code > 0x10FFFF) {
                throw new SyntaxError('Invalid Unicode code point ' + match[0]);
            }
            if (code <= 0xFFFF) {
                // Converting to \uNNNN avoids needing to escape the literal character and keep it
                // separate from preceding tokens
                return '\\u' + pad4(hex(code));
            }
            // If `code` is between 0xFFFF and 0x10FFFF, require and defer to native handling
            if (hasNativeU && flags.indexOf('u') > -1) {
                return match[0];
            }
            throw new SyntaxError('Cannot use Unicode code point above \\u{FFFF} without flag u');
        },
        {
            scope: 'all',
            leadChar: '\\'
        }
    );

/*
 * Empty character class: `[]` or `[^]`. This fixes a critical cross-browser syntax inconsistency.
 * Unless this is standardized (per the ES spec), regex syntax can't be accurately parsed because
 * character class endings can't be determined.
 */
    XRegExp.addToken(
        /\[(\^?)]/,
        function(match) {
            // For cross-browser compatibility with ES3, convert [] to \b\B and [^] to [\s\S].
            // (?!) should work like \b\B, but is unreliable in some versions of Firefox
            return match[1] ? '[\\s\\S]' : '\\b\\B';
        },
        {leadChar: '['}
    );

/*
 * Comment pattern: `(?# )`. Inline comments are an alternative to the line comments allowed in
 * free-spacing mode (flag x).
 */
    XRegExp.addToken(
        /\(\?#[^)]*\)/,
        function(match, scope, flags) {
            // Keep tokens separated unless the following token is a quantifier
            return isQuantifierNext(match.input, match.index + match[0].length, flags) ?
                '' : '(?:)';
        },
        {leadChar: '('}
    );

/*
 * Whitespace and line comments, in free-spacing mode (aka extended mode, flag x) only.
 */
    XRegExp.addToken(
        /\s+|#.*/,
        function(match, scope, flags) {
            // Keep tokens separated unless the following token is a quantifier
            return isQuantifierNext(match.input, match.index + match[0].length, flags) ?
                '' : '(?:)';
        },
        {flag: 'x'}
    );

/*
 * Dot, in dotall mode (aka singleline mode, flag s) only.
 */
    XRegExp.addToken(
        /\./,
        function() {
            return '[\\s\\S]';
        },
        {
            flag: 's',
            leadChar: '.'
        }
    );

/*
 * Named backreference: `\k<name>`. Backreference names can use the characters A-Z, a-z, 0-9, _,
 * and $ only. Also allows numbered backreferences as `\k<n>`.
 */
    XRegExp.addToken(
        /\\k<([\w$]+)>/,
        function(match) {
            // Groups with the same name is an error, else would need `lastIndexOf`
            var index = isNaN(match[1]) ? (indexOf(this.captureNames, match[1]) + 1) : +match[1],
                endIndex = match.index + match[0].length;
            if (!index || index > this.captureNames.length) {
                throw new SyntaxError('Backreference to undefined group ' + match[0]);
            }
            // Keep backreferences separate from subsequent literal numbers
            return '\\' + index + (
                endIndex === match.input.length || isNaN(match.input.charAt(endIndex)) ?
                    '' : '(?:)'
            );
        },
        {leadChar: '\\'}
    );

/*
 * Numbered backreference or octal, plus any following digits: `\0`, `\11`, etc. Octals except `\0`
 * not followed by 0-9 and backreferences to unopened capture groups throw an error. Other matches
 * are returned unaltered. IE < 9 doesn't support backreferences above `\99` in regex syntax.
 */
    XRegExp.addToken(
        /\\(\d+)/,
        function(match, scope) {
            if (
                !(
                    scope === defaultScope &&
                    /^[1-9]/.test(match[1]) &&
                    +match[1] <= this.captureNames.length
                ) &&
                match[1] !== '0'
            ) {
                throw new SyntaxError('Cannot use octal escape or backreference to undefined group ' +
                    match[0]);
            }
            return match[0];
        },
        {
            scope: 'all',
            leadChar: '\\'
        }
    );

/*
 * Named capturing group; match the opening delimiter only: `(?<name>`. Capture names can use the
 * characters A-Z, a-z, 0-9, _, and $ only. Names can't be integers. Supports Python-style
 * `(?P<name>` as an alternate syntax to avoid issues in some older versions of Opera which natively
 * supported the Python-style syntax. Otherwise, XRegExp might treat numbered backreferences to
 * Python-style named capture as octals.
 */
    XRegExp.addToken(
        /\(\?P?<([\w$]+)>/,
        function(match) {
            // Disallow bare integers as names because named backreferences are added to match
            // arrays and therefore numeric properties may lead to incorrect lookups
            if (!isNaN(match[1])) {
                throw new SyntaxError('Cannot use integer as capture name ' + match[0]);
            }
            if (match[1] === 'length' || match[1] === '__proto__') {
                throw new SyntaxError('Cannot use reserved word as capture name ' + match[0]);
            }
            if (indexOf(this.captureNames, match[1]) > -1) {
                throw new SyntaxError('Cannot use same name for multiple groups ' + match[0]);
            }
            this.captureNames.push(match[1]);
            this.hasNamedCapture = true;
            return '(';
        },
        {leadChar: '('}
    );

/*
 * Capturing group; match the opening parenthesis only. Required for support of named capturing
 * groups. Also adds explicit capture mode (flag n).
 */
    XRegExp.addToken(
        /\((?!\?)/,
        function(match, scope, flags) {
            if (flags.indexOf('n') > -1) {
                return '(?:';
            }
            this.captureNames.push(null);
            return '(';
        },
        {
            optionalFlags: 'n',
            leadChar: '('
        }
    );

/* ==============================
 * Expose XRegExp
 * ============================== */

    module.exports = XRegExp;






XRegExp.addToken(
    /\\Z/,
    function(match, scope, flags) {
      return '$';
    }
);
