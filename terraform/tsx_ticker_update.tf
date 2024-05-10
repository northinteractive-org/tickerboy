# Lambda Function Resource
resource "aws_lambda_function" "tickerboy_lambda" {
  function_name = "tickerboy_lambda"

  filename         = "lambda_function.zip"
  source_code_hash = filebase64sha256("lambda_function.zip")

  runtime = "python3.9"
  handler = "lambda_function.lambda_handler"


  role        = aws_iam_role.lambda_role.arn
  timeout     = 300
  memory_size = 512

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.tickerboy_stock_data.name
    }
  }
}


# CloudWatch Event Rule to Trigger Lambda Monthly
resource "aws_cloudwatch_event_rule" "monthly_trigger" {
  name                = "tickerboy_lambda_monthly_trigger"
  description         = "Triggers Tickerboy Lambda function monthly"
  schedule_expression = "cron(0 0 1 * ? *)" # Run at midnight on the 1st of every month
}

# CloudWatch Event Target (Lambda)
resource "aws_cloudwatch_event_target" "lambda_target" {
  rule      = aws_cloudwatch_event_rule.monthly_trigger.name
  target_id = "lambda"
  arn       = aws_lambda_function.tickerboy_lambda.arn
}

# Lambda Permission for CloudWatch Events
resource "aws_lambda_permission" "allow_cloudwatch_invocation" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.tickerboy_lambda.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.monthly_trigger.arn
}