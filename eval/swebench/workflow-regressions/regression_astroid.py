import astroid
for expression in ['"{:d}".format(None)', '"{:04d}".format(None)']:
    node = astroid.extract_node(expression)
    values = list(node.infer())
    assert values, 'Inference should produce an unknown result instead of crashing'
print('Public-issue format(None) inference regression passed')
