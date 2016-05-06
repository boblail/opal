require 'opal/nodes/base'

module Opal
  module Nodes
    class ValueNode < Base
      handle :true, :false, :self, :nil

      def compile
        push type.to_s
      end

      def self.truthy_optimize?
        true
      end
    end

    class NumericNode < Base
      handle :int, :float

      children :value

      def compile
        push value.to_s
        wrap '(', ')' if recv?
      end

      def self.truthy_optimize?
        true
      end
    end

    class StringNode < Base
      handle :str

      children :value

      ESCAPE_CHARS = {
        ?a => '\\u0007',
        ?e => '\\u001b'
      }

      ESCAPE_REGEX = /(\\+)([#{ ESCAPE_CHARS.keys.join('') }])/

      def translate_escape_chars(inspect_string)
        inspect_string.gsub(ESCAPE_REGEX) do |original|
          if $1.length.even?
            original
          else
            $1.chop + ESCAPE_CHARS[$2]
          end
        end
      end

      def compile
        push translate_escape_chars(value.inspect)
      end
    end

    class SymbolNode < Base
      handle :sym

      children :value

      def compile
        push value.to_s.inspect
      end
    end

    class RegexpNode < Base
      handle :regexp

      attr_accessor :value, :flags

      def initialize(*)
        super
        extract_flags_and_value
      end

      def compile
        push "new RegExp(", expr(value), ", '#{flags.join}')"
      end

      def extract_flags_and_value
        *values, flags_sexp = *children
        self.flags = flags_sexp.children.map(&:to_s)

        case values.length
        when 0
          # empty regexp, we can process it inline
          self.value = s(:str, '')
        when 1
          # simple plain regexp, we can put it inline
          self.value = values[0]
        else
          self.value = s(:dstr, *values)
        end

        # trimming when //x provided
        # required by parser gem, but JS doesn't support 'x' flag
        if flags.include?('x')
          parts = value.children.map do |part|
            if part.type == :str
              trimmed_value = part.children[0].gsub(/\A\s*\#.*/, '').gsub(/\s/, '')
              # binding.pry
              s(:str, trimmed_value)
            else
              part
            end
          end

          self.value = value.updated(nil, parts)
          flags.delete('x')
        end
      end

      def raw_value
        self.value = @sexp.loc.expression.source
      end
    end

    # $_ = 'foo'; call if /foo/
    # s(:if, s(:match_current_line, /foo/, true))
    class MatchCurrentLineNode < Base
      handle :match_current_line

      children :regexp

      # Here we just convert it to
      # ($_ =~ regexp)
      # and let :send node to handle it
      def compile
        gvar_sexp = s(:gvar, :$_)
        send_node = s(:send, gvar_sexp, :=~, regexp)
        push expr(send_node)
      end
    end

    module XStringLineSplitter
      def compile_split_lines(value, sexp)
        idx = 0
        value.each_line do |line|
          if idx == 0
            push line
          else
            line_sexp = s()
            line_sexp.source = [sexp.line + idx, 0]
            frag = Fragment.new(line, line_sexp)
            push frag
          end

          idx += 1
        end
      end
    end

    class XStringNode < Base
      include XStringLineSplitter

      handle :xstr

      # children :value

      def needs_semicolon?
        stmt? and !value.to_s.include?(';')
      end

      def compile
        # compile_split_lines(value.to_s, @sexp)

        # push ';' if needs_semicolon?

        # children.each do |child|
        #   case child.type
        #   when :str
        #     push
        #   when :begin
        #   end
        # end
        children.each do |child|
          case child.type
          when :str
            push Fragment.new(child.children[0], nil)
          when :begin
            push expr(compiler.returns(child))
          when :gvar, :ivar
            push expr(child)
          else
            raise "Unsupported xstr part: #{child.type}"
          end
        end

        wrap '(', ')' if recv?
      end

      def start_line
        @sexp.line
      end
    end

    class DynamicStringNode < Base
      handle :dstr

      def compile
        push '""'

        children.each_with_index do |part, idx|
          push " + "

          # if String === part
          #   push part.inspect
          # elsif part.type == :evstr
          #   push "("
          #   push part.children[0] ? expr(part.children[0]) : '""'
          #   push ")"
          if part.type == :str
            push part.children[0].inspect
          # elsif part.type == :dstr
          #   push "("
          #   push expr(part)
          #   push ")"
          elsif part.type == :begin
            push expr(compiler.returns(part))
          # elsif part.type == :dstr || part.type == :ivar
          else
            push "(", expr(part), ")"
          # else
          #   raise "Bad dstr part #{part.inspect}"
          end

          wrap '(', ')' if recv?
        end
      end
    end

    class DynamicSymbolNode < Base
      handle :dsym

      def compile
        children.each_with_index do |part, idx|
          push " + " unless idx == 0

          # if String === part
          #   push part.inspect
          # elsif part.type == :evstr
          #   push expr(s(:send, part.last, :to_s, s(:arglist)))
          if part.type == :str
            push part.children[0].inspect
          elsif part.type == :begin
            push "(", expr(part), ")"
          else
            raise "Bad dsym part"
          end
        end

        wrap '(', ')'
      end
    end

    class DynamicXStringNode < Base
      include XStringLineSplitter

      handle :dxstr

      def requires_semicolon(code)
        stmt? and !code.include?(';')
      end

      def compile
        needs_semicolon = false

        children.each do |part|
          if String === part
            compile_split_lines(part.to_s, @sexp)

            needs_semicolon = true if requires_semicolon(part.to_s)
          elsif part.type == :evstr
            push expr(part[1])
          elsif part.type == :str
            compile_split_lines(part.last.to_s, part)
            needs_semicolon = true if requires_semicolon(part.last.to_s)
          else
            raise "Bad dxstr part"
          end
        end

        push ';' if needs_semicolon
        wrap '(', ')' if recv?
      end
    end

    class DynamicRegexpNode < Base
      handle :dregx

      def compile
        children.each_with_index do |part, idx|
          push " + " unless idx == 0

          if String === part
            push part.inspect
          elsif part.type == :str
            push part[1].inspect
          else
            push expr(part[1])
          end
        end

        wrap '(new RegExp(', '))'
      end
    end

    class InclusiveRangeNode < Base
      handle :irange

      children :start, :finish

      def compile
        helper :range

        push '$range(', expr(start), ', ', expr(finish), ', false)'
      end
    end

    class ExclusiveRangeNode < Base
      handle :erange

      children :start, :finish

      def compile
        helper :range

        push '$range(', expr(start), ', ', expr(finish), ', true)'
      end
    end
  end
end
