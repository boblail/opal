require 'opal/nodes/base'

module Opal
  module Nodes

    class SvalueNode < Base
      handle :svalue

      children :value

      def compile
        push process(value, @level)
      end
    end

    class UndefNode < Base
      handle :undef

      def compile
        children.each do |child|
          value = child.children[0]
          statements = []
          if child.type == :js_return
             value = value.children[0]
             statements << expr(s(:js_return))
          end
          statements << "Opal.udef(self, '$#{value.to_s}');"
          if children.length > 1 && child != children.first
            line *statements
          else
            push *statements
          end
        end
      end
    end

    class AliasNode < Base
      handle :alias

      children :new_name_sexp, :old_name_sexp

      def new_name
        new_name_sexp.children[0].to_s
      end

      def old_name
        old_name_sexp.children[0].to_s
      end

      def compile
        if scope.class? or scope.module?
          scope.methods << "$#{new_name}"
        end

        push "Opal.alias(self, '#{new_name}', '#{old_name}')"
      end
    end

    class BeginNode < ScopeNode
      handle :begin

      def compile
        return push "nil" if children.empty?

        optimize_returning_one_child if simple_block?

        compile_body

        return if stmt?

        if wrap_with_function?
          wrap '(function() {', '})()'
        elsif wrapping?
          wrap '(', ')'
        end
      end

      def simple_block?
        children.length == 1
      end

      def wrap_with_function?
        @sexp.meta[:force_wrap] ||
          [:return, :js_return, :rescue, :if].include?(children.last.type)
      end

      def optimize_returning_one_child
        only_child = children.last

        if only_child.type == :js_return
          only_child = only_child.children[0]
        end

        @sexp = @sexp.updated(nil, [only_child])
      end

      def compile_body
        if @sexp.meta[:inline_block]
          children.each_with_index do |child, idx|
            push ',' unless idx == 0
            push expr(child)
          end
        elsif simple_block?
          push stmt(children.first)
        else
          children.each do |child|
            line stmt(child), ';'
          end
        end
      end

      def wrapping?
        simple_block? &&
          ![:if, :return, :js_return, :returnable_yield, :rescue, :next].include?(children.last.type)
      end
    end

    class KwBeginNode < BeginNode
      handle :kwbegin
    end

    class ParenNode < Base
      handle :paren

      children :body

      def compile
        if body.type == :block
          body.children.each_with_index do |child, idx|
            push ', ' unless idx == 0
            push expr(child)
          end

          wrap '(', ')'
        else
          push process(body, @level)
          wrap '(', ')' unless stmt?
        end
      end
    end
  end
end
