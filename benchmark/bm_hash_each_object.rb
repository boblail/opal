h = {}

10_000.times do |i|
  h[Object.new] = nil
end

1_000.times do |i|
  h.each{|k, v| nil}
end
