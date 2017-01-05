const GraphQLByteString = {
  parseLiteral: (ast) => {
    return Buffer.from(ast.value, 'base64');
  },
  serialize: (value) => {
    return value.toString('base64');
  },
};

export default GraphQLByteString;
