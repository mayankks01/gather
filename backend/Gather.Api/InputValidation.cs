namespace Gather.Api;
public static class InputValidation
{
    public static void Check(object? value)
    {
        if (value == null || !value.GetType().Name.EndsWith("Input", StringComparison.Ordinal)) return;
        foreach (var property in value.GetType().GetProperties())
            if (property.PropertyType == typeof(string) && new System.Reflection.NullabilityInfoContext().Create(property).ReadState != System.Reflection.NullabilityState.Nullable)
                Contracts.Require(property.GetValue(value) is string text && text.Length <= 50_000, $"A valid {property.Name} is required.");
    }
    public static RouteGroupBuilder ValidateInputs(this RouteGroupBuilder group)
    {
        group.AddEndpointFilter(async (context, next) => { foreach (var argument in context.Arguments) Check(argument); return await next(context); });
        return group;
    }
}
