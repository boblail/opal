opal_filter "Module" do
  fails "passed { |a, b = 1|  } creates a method that raises an ArgumentError when passed zero arguments"
  fails "passed { |a, b = 1|  } creates a method that raises an ArgumentError when passed three arguments"
  fails "Module#define_method passed {  } creates a method that raises an ArgumentError when passed one argument"
  fails "Module#define_method calls #method_added after the method is added to the Module"
  fails "Module#define_method passed {  } creates a method that raises an ArgumentError when passed two arguments"
  fails "Module#define_method passed { ||  } creates a method that raises an ArgumentError when passed one argument"
  fails "Module#define_method passed { ||  } creates a method that raises an ArgumentError when passed two arguments"
  fails "Module#define_method passed { |a|  } creates a method that raises an ArgumentError when passed zero arguments"
  fails "Module#define_method passed { |a|  } creates a method that raises an ArgumentError when passed zero arguments and a block"
  fails "Module#define_method passed { |a|  } creates a method that raises an ArgumentError when passed two arguments"
  fails "Module#define_method passed { |a, *b|  } creates a method that raises an ArgumentError when passed zero arguments"
  fails "Module#define_method passed { |a, b|  } creates a method that raises an ArgumentError when passed zero arguments"
  fails "Module#define_method passed { |a, b|  } creates a method that raises an ArgumentError when passed one argument"
  fails "Module#define_method passed { |a, b|  } creates a method that raises an ArgumentError when passed one argument and a block"
  fails "Module#define_method passed { |a, b|  } creates a method that raises an ArgumentError when passed three arguments"
  fails "Module#define_method passed { |a, b, *c|  } creates a method that raises an ArgumentError when passed zero arguments"
  fails "Module#define_method passed { |a, b, *c|  } creates a method that raises an ArgumentError when passed one argument"
  fails "Module#define_method passed { |a, b, *c|  } creates a method that raises an ArgumentError when passed one argument and a block"
  fails "Module#define_method does not change the arity check style of the original proc"
  fails "A class definition has no class variables"
  fails "A class definition allows the declaration of class variables in the body"
  fails "A class definition allows the declaration of class variables in a class method"
  fails "A class definition allows the declaration of class variables in an instance method"

  fails "Module#method_defined? converts the given name to a string using to_str"
  fails "Module#method_defined? raises a TypeError when the given object is not a string/symbol/fixnum"
  fails "Module#method_defined? returns true if a public or private method with the given name is defined in self, self's ancestors or one of self's included modules"

  fails "Module#const_defined? should not search parent scopes of classes and modules if inherit is false"
  fails "Module#const_get should not search parent scopes of classes and modules if inherit is false"
  fails "Module#const_get raises a NameError with the not found constant symbol"
  fails "Module#const_get calls #to_str to convert the given name to a String"
  fails "Module#const_get raises a TypeError if conversion to a String by calling #to_str fails"
  fails "Module#const_get does not search the singleton class of a Class or Module"
  fails "Module#const_get raises a NameError if the constant is defined in the receiver's supperclass and the inherit flag is false"
  fails "Module#const_get accepts a toplevel scope qualifier"
  fails "Module#const_get raises a NameError if a Symbol is a scoped constant name"
  fails "Module#const_get with dynamically assigned constants searches a module included in the immediate class before the superclass"
  fails "Module#const_get with dynamically assigned constants searches a module included in the superclass"
  fails "Module#const_get with dynamically assigned constants searches the superclass chain"

  fails "Module#class_variable_set sets the value of a class variable with the given name defined in an included module"
  fails "Module#class_variable_get returns the value of a class variable with the given name defined in an included module"

  fails "Module#module_function as a toggle (no arguments) in a Module body functions normally if both toggle and definitions inside a eval"

  fails "Module#module_function is a private method"
  fails "Module#module_function on Class raises a TypeError if calling after rebinded to Class"
  fails "Module#module_function with specific method names makes the instance methods private"
  fails "Module#module_function with specific method names tries to convert the given names to strings using to_str"
  fails "Module#module_function with specific method names raises a TypeError when the given names can't be converted to string using to_str"
  fails "Module#module_function with specific method names can make accessible private methods"
  fails "Module#module_function as a toggle (no arguments) in a Module body does not affect module_evaled method definitions also if outside the eval itself"
  fails "Module#module_function as a toggle (no arguments) in a Module body has no effect if inside a module_eval if the definitions are outside of it"

  fails "Module#include adds all ancestor modules when a previously included module is included again"
  fails "Module#include raises a TypeError when the argument is not a Module"
  fails "Module#include doesn't include module if it is included in a super class"
  fails "Module#include recursively includes new mixins"
  fails "Module#include preserves ancestor order"
  fails "Module#include detects cyclic includes"
  fails "Module#include ignores modules it has already included via module mutual inclusion"
  fails "Module#include? returns true if the given module is included by self or one of it's ancestors"
  fails "Module#include? raises a TypeError when no module was given"

  fails "Module#module_function as a toggle (no arguments) in a Module body doesn't affect definitions when inside an eval even if the definitions are outside of it"
  fails "Module#define_method raises a TypeError when an UnboundMethod from a child class is defined on a parent class"
  fails "Module#define_method raises a TypeError when an UnboundMethod from one class is defined on an unrelated class"
end
