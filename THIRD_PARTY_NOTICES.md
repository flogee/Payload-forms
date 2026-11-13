# Third-party notices

The files under `patches/payload-3.90.2-auth/` contain modified Payload CMS authentication implementation code, with a version- and hash-checked password-hashing compatibility adaptation for the Worker runtime. Preserve the following original notice when redistributing those files. Dependencies installed through npm retain their own licenses; consult their package metadata and license files when distributing a build.

## Payload CMS

MIT License

Copyright (c) 2018-2025 Payload CMS, Inc. <info@payloadcms.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## ReUI chart primitives

`src/components/report/Chart.tsx` adapts the ChartContainer, tooltip and legend primitives from [ReUI](https://github.com/keenthemes/reui/blob/067aa0dc7f8bbfec1cd76fc5ad31f842be5f569a/registry/bases/radix/ui/chart.tsx), revision `067aa0dc7f8bbfec1cd76fc5ad31f842be5f569a`. Tailwind classes and raw style injection were replaced by existing Forms design tokens and React style properties. No registry installer is executed and no new dependency is required.

Copyright (c) 2025 Keenthemes Inc. Distributed under the MIT License; see [license](third_party/reui-LICENSE.txt).
